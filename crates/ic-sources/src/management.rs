pub use ic_management_canister_types::{
    NodeMetrics, NodeMetricsHistoryArgs, NodeMetricsHistoryRecord, NodeMetricsHistoryResult,
    SubnetInfoArgs, SubnetInfoResult,
};

use crate::decode_candid;

pub fn decode_metrics(bytes: &[u8], start: u64) -> Result<NodeMetricsHistoryResult, String> {
    let history: NodeMetricsHistoryResult = decode_candid(bytes)?;
    if history.len() > 60
        || history.iter().any(|sample| sample.timestamp_nanos < start)
        || history
            .windows(2)
            .any(|pair| pair[0].timestamp_nanos >= pair[1].timestamp_nanos)
    {
        return Err("unexpected node metrics history bounds or ordering".into());
    }
    Ok(history)
}

#[cfg(test)]
mod tests {
    use super::*;
    use candid::{Principal, encode_one};

    #[test]
    fn sparse_history_and_inclusive_start_remain_distinct_from_missing_reply() {
        let samples = vec![
            NodeMetricsHistoryRecord {
                timestamp_nanos: 100,
                node_metrics: vec![],
            },
            NodeMetricsHistoryRecord {
                timestamp_nanos: 86_400_000_000_100,
                node_metrics: vec![NodeMetrics {
                    node_id: Principal::from_slice(&[1]),
                    num_blocks_proposed_total: 400,
                    num_block_failures_total: 0,
                }],
            },
        ];
        let bytes = encode_one(&samples).unwrap();
        assert_eq!(decode_metrics(&bytes, 100).unwrap(), samples);
        assert!(decode_metrics(&bytes, 101).is_err());
        assert!(decode_metrics(&bytes[..10], 100).is_err());
        assert_eq!(
            decode_metrics(&encode_one(NodeMetricsHistoryResult::new()).unwrap(), 100).unwrap(),
            vec![]
        );
    }
}
