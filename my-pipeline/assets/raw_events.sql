/* @bruin
name: raw.session_events
type: duckdb.sql
materialization:
  type: table
@bruin */

-- Every founder utterance + every agent reaction logged by the boardroom server.
SELECT
  session_id,
  CAST(ts AS TIMESTAMP) AS ts,
  turn,
  agent,
  topic,
  stance,
  CAST(score AS INTEGER) AS score,
  founder_quote,
  reason
FROM read_json_auto('data/events.jsonl', ignore_errors=true, format='newline_delimited')
