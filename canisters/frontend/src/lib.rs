#![cfg(target_arch = "wasm32")]

use std::{cell::RefCell, collections::BTreeMap, rc::Rc};

use ic_asset_certification::{Asset, AssetConfig, AssetFallbackConfig, AssetRouter};
use ic_http_certification::{
    CERTIFICATE_EXPRESSION_HEADER_NAME, DefaultCelBuilder, DefaultResponseCertification,
    HeaderField, HttpCertification, HttpCertificationPath, HttpCertificationTree,
    HttpCertificationTreeEntry, HttpRequest, HttpResponse, Method, StatusCode,
    utils::add_v2_certificate_header,
};
use include_dir::{Dir, include_dir};

#[used]
#[unsafe(link_section = "icp:public supported_certificate_versions")]
static CERTIFICATE_VERSIONS: [u8; 1] = *b"2";

static ASSETS: Dir<'_> = include_dir!("$NEXUS_EMBEDDED_ASSETS");
const MISSING: &str = "404.html";
const CSP: &str = "default-src 'self'; connect-src 'self' https://icp-api.io;     script-src 'self'; style-src 'self'; style-src-attr 'none'; worker-src 'none'; frame-src 'none';     object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors";

struct Head {
    response: HttpResponse<'static>,
    entry: HttpCertificationTreeEntry<'static>,
}

struct CertifiedAssets {
    router: AssetRouter<'static>,
    tree: Rc<RefCell<HttpCertificationTree>>,
    heads: BTreeMap<String, Head>,
    missing_head: Head,
}

thread_local! {
    static CERTIFIED: RefCell<Option<CertifiedAssets>> = const { RefCell::new(None) };
}

fn asset_headers(name: &str) -> Vec<HeaderField> {
    let ancestor = option_env!("IC_WIDGET_HOST_ORIGIN").unwrap_or("'none'");
    let csp = format!("{CSP} {ancestor}");
    let cache = if name.ends_with(".html") {
        "public, no-cache, no-store"
    } else {
        "public, max-age=31536000, immutable"
    };
    [
        ("cache-control", cache),
        ("content-security-policy", csp.as_str()),
        ("x-content-type-options", "nosniff"),
        ("referrer-policy", "no-referrer"),
        (
            "strict-transport-security",
            "max-age=31536000; includeSubDomains",
        ),
        ("cross-origin-embedder-policy", "require-corp"),
        ("cross-origin-opener-policy", "same-origin"),
        ("cross-origin-resource-policy", "same-origin"),
        (
            "permissions-policy",
            "camera=(), geolocation=(), microphone=()",
        ),
    ]
    .map(|(key, value)| (key.into(), value.into()))
    .into()
}

fn aliases(name: &str) -> Vec<String> {
    if name != "index.html" {
        return vec![];
    }
    if option_env!("IC_WIDGET_EMBED_VIEW").is_some() {
        vec!["/".into(), "/embed".into()]
    } else {
        vec!["/".into()]
    }
}

fn content_type(name: &str) -> &'static str {
    match name {
        "index.html" | MISSING => "text/html; charset=utf-8",
        _ if name.starts_with("app.") && name.ends_with(".js") => "text/javascript; charset=utf-8",
        _ if name.starts_with("styles.") && name.ends_with(".css") => "text/css; charset=utf-8",
        _ => ic_cdk::trap("unexpected embedded frontend asset"),
    }
}

// Same GET router and shared HEAD certification tree as the pinned Jupiter frontend.
fn certify_assets() {
    let tree = Rc::new(RefCell::new(HttpCertificationTree::default()));
    let mut router = AssetRouter::with_tree(tree.clone());
    let mut assets = Vec::new();
    let mut configs = Vec::new();
    let mut heads = BTreeMap::new();
    let mut missing_head = None;

    for file in ASSETS.files() {
        let name = file.path().to_str().expect("UTF-8 embedded filename");
        let body = file.contents();
        let missing = name == MISSING;
        let status = if missing {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::OK
        };
        let path = format!("/{name}");
        let mime = content_type(name);
        let headers = asset_headers(name);
        assets.push(Asset::new(name, body));
        configs.push(AssetConfig::File {
            path: name.to_string(),
            content_type: Some(mime.into()),
            headers: headers.clone(),
            fallback_for: if missing {
                vec![AssetFallbackConfig {
                    scope: "/".into(),
                    status_code: Some(StatusCode::NOT_FOUND),
                }]
            } else {
                vec![]
            },
            aliased_by: aliases(name),
            encodings: vec![],
        });

        let mut head_headers = headers;
        head_headers.extend([
            ("content-type".into(), mime.into()),
            ("content-length".into(), body.len().to_string()),
        ]);
        let exact = certified_head(
            &mut tree.borrow_mut(),
            &path,
            false,
            StatusCode::OK,
            &head_headers,
        );
        heads.insert(path, exact);
        for alias in aliases(name) {
            let head = certified_head(&mut tree.borrow_mut(), &alias, false, status, &head_headers);
            heads.insert(alias, head);
        }
        if missing {
            missing_head = Some(certified_head(
                &mut tree.borrow_mut(),
                "/",
                true,
                status,
                &head_headers,
            ));
        }
    }

    router
        .certify_assets(assets, configs)
        .unwrap_or_else(|error| ic_cdk::trap(format!("certify embedded frontend assets: {error}")));
    ic_cdk::api::certified_data_set(tree.borrow().root_hash());
    CERTIFIED.with_borrow_mut(|stored| {
        *stored = Some(CertifiedAssets {
            router,
            tree,
            heads,
            missing_head: missing_head.expect("404 asset"),
        });
    });
}

fn certified_head(
    tree: &mut HttpCertificationTree,
    path: &str,
    fallback: bool,
    status: StatusCode,
    headers: &[HeaderField],
) -> Head {
    let expression = DefaultCelBuilder::full_certification()
        .with_response_certification(DefaultResponseCertification::response_header_exclusions(
            vec![],
        ))
        .build();
    let mut headers = headers.to_vec();
    headers.push((
        CERTIFICATE_EXPRESSION_HEADER_NAME.into(),
        expression.to_string(),
    ));
    let response = HttpResponse::builder()
        .with_status_code(status)
        .with_headers(headers)
        .build();
    let request = HttpRequest::builder()
        .with_method(Method::HEAD)
        .with_url(path)
        .build();
    let certification = HttpCertification::full(&expression, &request, &response, None)
        .expect("certify frontend HEAD");
    let path = if fallback {
        HttpCertificationPath::wildcard(path.to_string())
    } else {
        HttpCertificationPath::exact(path.to_string())
    };
    let entry = HttpCertificationTreeEntry::new(path, certification);
    tree.insert(&entry);
    Head { response, entry }
}

#[ic_cdk::init]
fn init() {
    certify_assets();
}

#[ic_cdk::post_upgrade]
fn post_upgrade() {
    certify_assets();
}

fn is_raw_host(host: &str) -> bool {
    let host = host.trim().split(':').next().unwrap_or_default();
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let raw_domain = |domain| {
        matches!(
            domain,
            "raw.icp.net" | "raw.icp0.io" | "raw.ic0.app" | "raw.localhost"
        )
    };
    raw_domain(host.as_str())
        || host
            .split_once('.')
            .is_some_and(|(_, domain)| raw_domain(domain))
}

#[ic_cdk::query]
fn http_request(request: HttpRequest<'_>) -> HttpResponse<'static> {
    // The gateway forwards Host. It is a deployment convention and is not proof of verification.
    if request
        .headers()
        .iter()
        .any(|(name, value)| name.eq_ignore_ascii_case("host") && is_raw_host(value))
    {
        return error_response(StatusCode::FORBIDDEN);
    }
    let method = request.method();
    if method != Method::GET && method != Method::HEAD {
        return error_response(StatusCode::METHOD_NOT_ALLOWED);
    }
    let Ok(path) = request.get_path() else {
        return error_response(StatusCode::BAD_REQUEST);
    };
    let certificate = ic_cdk::api::data_certificate().expect("query data certificate");
    CERTIFIED.with_borrow(|stored| {
        let assets = stored.as_ref().expect("initialized frontend assets");
        if method == Method::GET {
            return assets
                .router
                .serve_asset(&certificate, &request)
                .unwrap_or_else(|_| error_response(StatusCode::BAD_REQUEST));
        }
        let head = assets.heads.get(&path).unwrap_or(&assets.missing_head);
        let Ok(witness) = assets.tree.borrow().witness(&head.entry, &path) else {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR);
        };
        let mut response = head.response.clone();
        add_v2_certificate_header(
            &certificate,
            &mut response,
            &witness,
            &head.entry.path.to_expr_path(),
        );
        response
    })
}

fn error_response(status: StatusCode) -> HttpResponse<'static> {
    HttpResponse::builder()
        .with_status_code(status)
        .with_headers(asset_headers(MISSING))
        .build()
}

ic_cdk::export_candid!();
