-- BigQuery: ERC-8004 NewFeedback events (one row per feedback signal).
-- Dataset: bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs
--
-- NewFeedback(uint256 indexed agentId, address indexed clientAddress,
--   uint64 feedbackIndex, int128 value, uint8 valueDecimals,
--   string indexed indexedTag1, string tag1, string tag2, string endpoint,
--   string feedbackURI, bytes32 feedbackHash)
--
-- Non-indexed args are ABI-encoded in `data`. The indexer decodes them with viem
-- (decodeEventLog) for full fidelity; this SQL pulls the numeric head slots that
-- BigQuery can decode cheaply (feedbackIndex, value, valueDecimals) for analytics.
--
-- Data layout (each slot = 64 hex chars; data starts with '0x'):
--   slot0 chars  3..66  = feedbackIndex (uint64)
--   slot1 chars 67..130 = value (int128, two's-complement)
--   slot2 chars131..194 = valueDecimals (uint8)
--
-- Parameters:
--   @reputation_registry  e.g. '0x8004baa17c55a88189ae136b182e5fda19de9b63'
--   @topic_newfeedback    e.g. '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc'
--   @since                TIMESTAMP launch-date partition prune

SELECT
  SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64)              AS agent_id,
  CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))        AS client,
  SAFE_CAST(CONCAT('0x', SUBSTR(data,   3, 64)) AS INT64) AS feedback_index,
  SAFE_CAST(CONCAT('0x', SUBSTR(data,  67, 64)) AS INT64) AS value,
  SAFE_CAST(CONCAT('0x', SUBSTR(data, 131, 64)) AS INT64) AS value_decimals,
  block_number,
  block_timestamp,
  transaction_hash
FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`
WHERE address = @reputation_registry
  AND topics[SAFE_OFFSET(0)] = @topic_newfeedback
  AND block_timestamp >= TIMESTAMP(@since)
ORDER BY block_timestamp ASC;
