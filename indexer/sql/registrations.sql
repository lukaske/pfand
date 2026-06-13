-- BigQuery: ERC-8004 Registered events (one row per agent registration).
-- Aligned with Google's workshop gist:
--   https://gist.github.com/godeva/040270ac2924501063d875b302cf2e91
-- Dataset: bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs
--
-- Decoding (done in the indexer via viem decodeEventLog, but mirrored here so the
-- query is self-contained):
--   agent_id  = topics[1]            (indexed uint256)
--   owner     = topics[2] last 20 b  (indexed address)
--   agent_uri = data string          (offset/length ABI-encoded)
--
-- Parameters (named query params, set by src/bigquery.ts):
--   @identity_registry  e.g. '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432'
--   @topic_registered   e.g. '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a'
--   @since              TIMESTAMP launch-date partition prune, e.g. '2026-01-28'

SELECT
  SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64)       AS agent_id,
  CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27)) AS owner,
  SAFE_CONVERT_BYTES_TO_STRING(FROM_HEX(SUBSTR(
    data,
    131,
    2 * SAFE_CAST(CONCAT('0x', SUBSTR(data, 67, 64)) AS INT64)
  )))                                              AS agent_uri,
  block_number,
  block_timestamp,
  transaction_hash
FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`
WHERE address = @identity_registry
  AND topics[SAFE_OFFSET(0)] = @topic_registered
  AND block_timestamp >= TIMESTAMP(@since)
ORDER BY block_timestamp ASC;
