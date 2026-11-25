use candid::Principal;
use nexus_ic_sources::projection::Details;
use nexus_review_engine::{Coordinates, DataCenter, Node, Operator, Subnet};

pub fn roster(details: Details) -> Option<Vec<Principal>> {
    match details {
        Details::SubnetList(ids) => Some(ids),
        _ => None,
    }
}

pub fn subnet(details: Details) -> Option<Subnet> {
    match details {
        Details::Subnet {
            members,
            kind,
            sev_enabled: Some(sev_enabled),
            ..
        } => Some(Subnet {
            members,
            kind,
            sev_enabled,
        }),
        _ => None,
    }
}

pub fn node(details: Details) -> Option<Node> {
    match details {
        Details::Node {
            operator,
            reward_type,
            has_chip_id: Some(has_chip_id),
            ..
        } => Some(Node {
            operator,
            reward_type,
            has_chip_id,
        }),
        _ => None,
    }
}

pub fn boundary(details: Details) -> Option<()> {
    matches!(details, Details::ApiBoundary { .. }).then_some(())
}

pub fn operator(details: Details) -> Option<Operator> {
    match details {
        Details::Operator {
            provider,
            data_center,
            ..
        } => Some(Operator {
            provider,
            data_center,
        }),
        _ => None,
    }
}

pub fn data_center(details: Details) -> Option<DataCenter> {
    match details {
        Details::DataCenter {
            registered_region,
            registered_owner,
            gps,
            ..
        } => Some(DataCenter {
            registered_region,
            registered_owner,
            coordinates: gps.and_then(|gps| {
                Coordinates::from_degrees(f64::from(gps.latitude), f64::from(gps.longitude))
            }),
        }),
        _ => None,
    }
}
