# Frontend release candidate

`SOURCE_COMMIT` identifies the asset source and `SHA256SUMS` covers the published archive and its source reference. The archive contains `index.html`, `app.js`, `styles.css` and `.ic-assets.json5`. It targets the existing reviewer `s34gv-3qaaa-aaaar-qcifa-cai` using the production IC agent and trust root. Static assets include the bundled map geometry. The asset policy retains certified serving, the existing security headers and disabled raw access.

To reproduce the archive on Linux from the source commit:

```bash
npm --prefix web ci
DFX_NETWORK=ic CANISTER_ID_REVIEWER=s34gv-3qaaa-aaaar-qcifa-cai npm --prefix web run build
tar --sort=name --format=ustar --mtime=@0 --owner=0 --group=0 --numeric-owner \
  -C web/dist -cf - . | gzip -n > frontend-assets.tar.gz
```

## After separate deployment approval

Check the published archive with `sha256sum --check SHA256SUMS` in this directory. Prepare a fresh isolated project using the existing [frontend-only DFX configuration](../../review-artifacts/release/frontend-only). Unpack the archive into its empty `assets/` directory. Confirm that `dfx canister id --network ic frontend` resolves to `s45ab-wiaaa-aaaar-qcifq-cai` and check its current controllers, installed asset module and available cycles. The project contains one `frontend` entry and no backend entry.

On the approved frontend target, use asset sync with the installed asset module:

```bash
dfx canister install --network ic --identity codex_local \
  --mode upgrade --no-asset-upgrade frontend
```

Verify the certified site at `https://s45ab-wiaaa-aaaar-qcifq-cai.icp0.io/`, its JS/CSS and controller set. Test the browser against the existing reviewer under the current pilot authorization procedure. A new tab generates a new public principal. The currently deployed [voting-grade frontend archive](../../review-artifacts/release/frontend-assets.tar.gz) is available for an authorized asset rollback using the same isolated project. This candidate has no backend upgrade or Candid migration.
