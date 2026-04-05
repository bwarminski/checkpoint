# ABOUTME: Verifies one-shot collection from Postgres stats into query event rows.
# ABOUTME: Covers empty polling results and the ClickHouse payload shape for inserts.
require "minitest/autorun"
require "tmpdir"
require_relative "../lib/collector"
require_relative "support/env"

class CollectorTest < Minitest::Test
  def test_env_loader_preserves_exported_values
    Dir.mktmpdir do |dir|
      env_path = File.join(dir, ".env")
      File.write(env_path, "DEMO_REPO=file/value\nDEMO_BASE_REF=main\n")

      previous_demo_repo = ENV["DEMO_REPO"]
      previous_demo_base_ref = ENV["DEMO_BASE_REF"]
      ENV["DEMO_REPO"] = "shell/value"
      ENV.delete("DEMO_BASE_REF")

      begin
        load_env_file(env_path)

        assert_equal "shell/value", ENV["DEMO_REPO"]
        assert_equal "main", ENV["DEMO_BASE_REF"]
      ensure
        restore_env("DEMO_REPO", previous_demo_repo)
        restore_env("DEMO_BASE_REF", previous_demo_base_ref)
      end
    end
  end

  def test_env_loader_parses_quoted_values_and_inline_comments
    Dir.mktmpdir do |dir|
      env_path = File.join(dir, ".env")
      File.write(
        env_path,
        [
          "A=one # comment",
          'B="two # not comment"',
          "C='three # not comment'",
          'D="line\nquote"',
        ].join("\n"),
      )

      %w[A B C D].each { |key| ENV.delete(key) }

      load_env_file(env_path)

      assert_equal "one", ENV["A"]
      assert_equal "two # not comment", ENV["B"]
      assert_equal "three # not comment", ENV["C"]
      assert_equal "line\nquote", ENV["D"]
    end
  end

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
        mean_exec_time_ms: 12.5,
        rows_examined: 0,
        mean_rows_examined: 0.0
      }
    ]

    assert_equal expected_rows, rows
    assert_equal "query_events", clickhouse_connection.table
    assert_equal expected_rows, clickhouse_connection.rows
  end

  def test_run_once_captures_rows_examined_metrics
    stats_connection = StatsConnection.new([
      {
        "queryid" => "123",
        "calls" => "10",
        "mean_exec_time" => "15.5",
        "rows" => "2500"
      }
    ])
    collector = Collector.new(
      stats_connection: stats_connection,
      clock: -> { Time.utc(2026, 4, 5, 12, 0, 0) }
    )

    row = collector.run_once.first

    assert_equal 2500, row[:rows_examined]
    assert_in_delta 250.0, row[:mean_rows_examined], 0.001
  end

  def test_uses_only_the_rails_metadata_block_when_query_has_multiple_comments
    stats_connection = StatsConnection.new([
      {
        "queryid" => "42",
        "calls" => "7",
        "mean_exec_time" => "12.5"
      }
    ])
    clickhouse_connection = ClickhouseConnection.new
    sample_query = "SELECT * FROM todos /*hint:seqscan_off*/ /*application:demo,controller:todos,action:index,source_location:/app/controllers/todos_controller.rb:12*/ /*note:trailing*/"
    sample_query_lookup = SampleQueryLookupStub.new("42" => sample_query)
    collector = Collector.new(
      stats_connection: stats_connection,
      clickhouse_connection: clickhouse_connection,
      sample_query_lookup: sample_query_lookup,
      clock: -> { Time.utc(2026, 4, 4, 12, 0, 0) }
    )

    row = collector.run_once.fetch(0)

    assert_equal "todos#index", row[:source_tag]
    assert_equal "/app/controllers/todos_controller.rb:12", row[:source_file]
  end

  def test_extracts_source_tag_from_live_rails_equals_style_comments
    stats_connection = StatsConnection.new([
      {
        "queryid" => "42",
        "calls" => "7",
        "mean_exec_time" => "12.5"
      }
    ])
    clickhouse_connection = ClickhouseConnection.new
    sample_query = "SELECT * FROM todos /*action=\\'index\\',application=\\'Demo\\',controller=\\'todos\\'*/"
    sample_query_lookup = SampleQueryLookupStub.new("42" => sample_query)
    collector = Collector.new(
      stats_connection: stats_connection,
      clickhouse_connection: clickhouse_connection,
      sample_query_lookup: sample_query_lookup,
      clock: -> { Time.utc(2026, 4, 4, 12, 0, 0) }
    )

    row = collector.run_once.fetch(0)

    assert_equal "todos#index", row[:source_tag]
    assert_nil row[:source_file]
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

  def restore_env(key, value)
    if value.nil?
      ENV.delete(key)
    else
      ENV[key] = value
    end
  end
end
