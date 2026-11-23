/* @bruin
name: analytics.agent_scores
type: duckdb.sql
materialization:
  type: table
depends:
  - raw.session_events
columns:
  - name: session_id
    type: string
    checks:
      - name: not_null
  - name: avg_score
    type: float
    checks:
      - name: not_null
@bruin */

SELECT session_id, agent, round(avg(score), 2) AS avg_score, count(*) AS reactions
FROM raw.session_events
GROUP BY 1, 2
