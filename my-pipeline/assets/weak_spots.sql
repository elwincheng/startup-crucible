/* @bruin
name: analytics.founder_weak_spots
type: duckdb.sql
materialization:
  type: table
depends:
  - raw.session_events
@bruin */

-- Cross-session memory: topics where the founder scores worst, with the quote as evidence.
-- The server reads this at session start so agents press harder on past weaknesses.
WITH ranked AS (
  SELECT topic, agent, score, founder_quote, reason,
         row_number() OVER (PARTITION BY topic ORDER BY score ASC) AS rn
  FROM raw.session_events
  WHERE topic IS NOT NULL
)
SELECT t.topic, round(avg(e.score), 2) AS avg_score, count(*) AS n,
       any_value(r.founder_quote) AS worst_quote, any_value(r.agent) AS worst_agent, any_value(r.reason) AS worst_reason
FROM raw.session_events e
JOIN (SELECT DISTINCT topic FROM ranked) t USING (topic)
JOIN ranked r ON r.topic = t.topic AND r.rn = 1
GROUP BY t.topic
ORDER BY avg_score ASC
