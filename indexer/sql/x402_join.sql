-- BigQuery: "Trustworthy AND payable" — identity x reputation join, with the
-- x402Support flag decoded straight out of on-chain base64 agent cards (data: URIs).
-- Mirrors Query 4 of Google's workshop gist.
-- Dataset: bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs
--
-- For off-chain agent cards (ipfs://, https://) x402_support is NULL here and is
-- resolved by the indexer after fetching the JSON (src/bigquery.ts).
--
-- Parameters:
--   @identity_registry, @reputation_registry
--   @topic_registered, @topic_newfeedback
--   @since

WITH agents AS (
  SELECT
    SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64)       AS agent_id,
    CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27)) AS owner,
    SAFE_CONVERT_BYTES_TO_STRING(FROM_HEX(SUBSTR(
      data,
      131,
      2 * SAFE_CAST(CONCAT('0x', SUBSTR(data, 67, 64)) AS INT64)
    )))                                              AS agent_uri
  FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`
  WHERE address = @identity_registry
    AND topics[SAFE_OFFSET(0)] = @topic_registered
    AND block_timestamp >= TIMESTAMP(@since)
),
scores AS (
  SELECT
    SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64) AS agent_id,
    COUNT(DISTINCT CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))) AS unique_clients,
    ROUND(AVG(
      SAFE_CAST(CONCAT('0x', SUBSTR(data, 67, 64)) AS INT64) /
      POW(10, SAFE_CAST(CONCAT('0x', SUBSTR(data, 131, 64)) AS INT64))
    ), 2) AS avg_score
  FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`
  WHERE address = @reputation_registry
    AND topics[SAFE_OFFSET(0)] = @topic_newfeedback
    AND block_timestamp >= TIMESTAMP(@since)
    AND SUBSTR(data, 67, 1) != 'f'
  GROUP BY 1
)
SELECT
  a.agent_id,
  a.agent_uri,
  s.avg_score,
  s.unique_clients,
  STARTS_WITH(a.agent_uri, 'data:application/json;base64,') AS fully_onchain,
  IF(
    STARTS_WITH(a.agent_uri, 'data:application/json;base64,'),
    JSON_VALUE(SAFE_CONVERT_BYTES_TO_STRING(SAFE.FROM_BASE64(
      SUBSTR(a.agent_uri, LENGTH('data:application/json;base64,') + 1)
    )), '$.x402Support'),
    NULL
  ) AS x402_support
FROM agents a
JOIN scores s USING (agent_id)
ORDER BY s.avg_score DESC;
