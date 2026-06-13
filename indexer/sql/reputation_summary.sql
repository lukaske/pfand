-- BigQuery: per-agent reputation leaderboard (Sybil-resistant).
-- Mirrors Query 3 of Google's workshop gist. Requires >= 3 distinct clients.
-- Dataset: bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs
--
-- Parameters:
--   @reputation_registry
--   @topic_newfeedback
--   @since
--   @min_clients   default 3 (Sybil barrier)

WITH fb AS (
  SELECT
    SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64)              AS agent_id,
    CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))        AS client,
    SAFE_CAST(CONCAT('0x', SUBSTR(data,  67, 64)) AS INT64) AS raw_value,
    SAFE_CAST(CONCAT('0x', SUBSTR(data, 131, 64)) AS INT64) AS value_decimals
  FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`
  WHERE address = @reputation_registry
    AND topics[SAFE_OFFSET(0)] = @topic_newfeedback
    AND block_timestamp >= TIMESTAMP(@since)
    AND SUBSTR(data, 67, 1) != 'f'   -- skip negative (two's-complement) ratings
)
SELECT
  agent_id,
  COUNT(*)                                           AS feedback_count,
  COUNT(DISTINCT client)                             AS unique_clients,
  ROUND(AVG(raw_value / POW(10, value_decimals)), 2) AS avg_score
FROM fb
GROUP BY agent_id
HAVING unique_clients >= @min_clients
ORDER BY avg_score DESC, unique_clients DESC
LIMIT 100;
