# ABOUTME: Verifies one-shot collection from Postgres stats into query event rows.
# ABOUTME: Covers empty polling results and the ClickHouse payload shape for inserts.
require "minitest/autorun"
require_relative "../lib/collector"

class CollectorTest < Minitest::Test
  def test_returns_empty_array_when_no_stats_rows_exist
    stats_connection = StatsConnection.new([])
    clickhouse_connection = ClickhouseConnection.new
    sample_query_lookup = SampleQueryLookupStub.new({})
    collector = Collector.new(
      stats_connection: stats_connection,
      clickhouse_connection: clickhouse_connection,
      sample_query_lookup: sample_query_lookup,
      clock: -> { Time.utc(2026, 4, 4, 12, 0, 0) }
    )

    assert_equal [], collector.run_once
    assert_nil clickhouse_connection.table
    assert_nil clickhouse_connection.rows
  end

  def test_inserts_query_event_rows_with_source_metadata
    stats_connection = StatsConnection.new([
      {
        "queryid" => "42",
        "calls" => "7",
        "mean_exec_time" => "12.5"
      }
    ])
    clickhouse_connection = ClickhouseConnection.new
    sample_query = "SELECT * FROM todos /*application:demo,controller:todos,action:index,source_location:/app/controllers/todos_controller.rb:12*/"
    sample_query_lookup = SampleQueryLookupStub.new("42" => sample_query)
    collector = Collector.new(
      stats_connection: stats_connection,
      clickhouse_connection: clickhouse_connection,
      sample_query_lookup: sample_query_lookup,
      clock: -> { Time.utc(2026, 4, 4, 12, 0, 0) }
    )

    rows = collector.run_once

    expected_rows = [
      {
        collected_at: Time.utc(2026, 4, 4, 12, 0, 0),
        fingerprint: "42",
        source_tag: "todos#index",
        source_file: "/app/controllers/todos_controller.rb:12",
        sample_query: sample_query,
        total_exec_count: 7,
        mean_exec_time_ms: 12.5
      }
    ]

    assert_equal expected_rows, rows
    assert_equal "query_events", clickhouse_connection.table
    assert_equal expected_rows, clickhouse_connection.rows
  end

  class StatsConnection
    attr_reader :sql

    def initialize(rows)
      @rows = rows
    end

    def exec(sql)
      @sql = sql
      @rows
    end
  end

  class ClickhouseConnection
    attr_reader :table, :rows

    def insert(table, rows)
      @table = table
      @rows = rows
    end
  end

  class SampleQueryLookupStub
    def initialize(queries)
      @queries = queries
    end

    def find_for(queryid)
      @queries.fetch(queryid.to_s, nil)
    end
  end
end
