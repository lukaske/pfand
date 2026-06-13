-- BigQuery: daily activity heatmap (registrations + feedback per day).
-- Feeds the `activity` table (ActivityBucket in db.ts).
-- Dataset: bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs
--
-- Parameters:
--   @identity_registry
--   @reputation_registry
--   @topic_registered
--   @topic_newfeedback
--   @since

WITH events AS (
  SELECT
    DATE(block_timestamp) AS day,
    CASE
      WHEN address = @identity_registry   AND topics[SAFE_OFFSET(0)] = @topic_registered  THEN 'reg'
      WHEN address = @reputation_registry AND topics[SAFE_OFFSET(0)] = @topic_newfeedback THEN 'fb'
    END AS kind
  FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`
  WHERE block_timestamp >= TIMESTAMP(@since)
    AND (
      (address = @identity_registry   AND topics[SAFE_OFFSET(0)] = @topic_registered) OR
      (address = @reputation_registry AND topics[SAFE_OFFSET(0)] = @topic_newfeedback)
    )
)
SELECT
  day,
  COUNTIF(kind = 'reg') AS registrations,
  COUNTIF(kind = 'fb')  AS feedback
FROM events
WHERE kind IS NOT NULL
GROUP BY day
ORDER BY day ASC;
