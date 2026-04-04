# ABOUTME: Polls Postgres statement stats and shapes rows for ClickHouse inserts.
# ABOUTME: Enriches sampled SQL with source metadata parsed from Rails query comments.
require_relative "query_comment_parser"

class Collector
  STATS_SQL = "SELECT queryid, calls, mean_exec_time FROM pg_stat_statements".freeze

  def initialize(stats_connection: nil, clickhouse_connection: nil, sample_query_lookup: nil, clock: -> { Time.now.utc })
    @stats_connection = stats_connection
    @clickhouse_connection = clickhouse_connection
    @sample_query_lookup = sample_query_lookup
    @clock = clock
  end

  def run_once
    return [] unless @stats_connection

    stats_rows = Array(@stats_connection.exec(STATS_SQL))
    return [] if stats_rows.empty?

    collected_at = @clock.call
    rows = stats_rows.map do |stats_row|
      build_row(stats_row, collected_at)
    end

    @clickhouse_connection&.insert("query_events", rows)
    rows
  end

  private

  def build_row(stats_row, collected_at)
    queryid = stats_row.fetch("queryid").to_s
    sample_query = @sample_query_lookup&.find_for(queryid)
    parsed = QueryCommentParser.parse(extract_comment(sample_query))

    {
      collected_at: collected_at,
      fingerprint: queryid,
      source_tag: presence(parsed[:source_tag]),
      source_file: presence(parsed[:source_file]),
      sample_query: sample_query,
      total_exec_count: stats_row.fetch("calls").to_i,
      mean_exec_time_ms: stats_row.fetch("mean_exec_time").to_f
    }
  end

  def extract_comment(sample_query)
    sample_query.to_s[/\/\*.*\*\//]
  end

  def presence(value)
    value unless value.to_s.empty?
  end
end
