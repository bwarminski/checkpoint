# ABOUTME: Verifies the ClickHouse schema files for the query collector.
# ABOUTME: Guards the materialized view definition against embedding ORDER BY.
require "minitest/autorun"

class ClickhouseSchemaTest < Minitest::Test
  def test_materialized_view_is_source_tag_aware
    sql = read_sql("003_top_offenders_mv.sql")

    refute_match(/\bORDER BY\b/i, sql)
    assert_includes sql, "CREATE MATERIALIZED VIEW"
    refute_match(/\banyState\b/i, sql)
    assert_includes sql, "source_tag,"
    assert_includes sql, "argMaxState((source_file, sample_query), collected_at) AS representative_state"
    assert_includes sql, "sumState(total_exec_count * mean_exec_time_ms) AS total_exec_time_ms_state"
    assert_includes sql, "GROUP BY fingerprint, source_tag"
  end

  def test_fingerprint_table_stores_source_tag_rows
    sql = read_sql("002_query_fingerprints.sql")

    assert_includes sql, "source_tag Nullable(String)"
    assert_includes sql, "representative_state AggregateFunction(argMax, Tuple(Nullable(String), Nullable(String)), DateTime64(3))"
    assert_includes sql, "total_exec_time_ms_state AggregateFunction(sum, Float64)"
    assert_includes sql, "ORDER BY (fingerprint, source_tag)"
  end

  def test_reset_sql_rebuilds_query_fingerprints_with_execution_time_state
    sql = read_sql("004_reset_query_fingerprints.sql")

    assert_includes sql, "Run this only while collector ingestion is stopped so no raw events are missed."
    assert_includes sql, "DROP TABLE IF EXISTS top_offenders_mv"
    assert_includes sql, "DROP TABLE IF EXISTS query_fingerprints"
    assert_includes sql, "CREATE TABLE query_fingerprints"
    assert_includes sql, "INSERT INTO query_fingerprints"
    assert_includes sql, "argMaxState((source_file, sample_query), collected_at) AS representative_state"
    assert_includes sql, "sumState(total_exec_count * mean_exec_time_ms) AS total_exec_time_ms_state"
    assert_includes sql, "CREATE MATERIALIZED VIEW top_offenders_mv"
  end

  def test_query_events_store_subsecond_collection_times
    sql = read_sql("001_query_events.sql")

    assert_includes sql, "collected_at DateTime64(3)"
  end

  private

  def read_sql(name)
    File.read(File.expand_path("../../db/clickhouse/#{name}", __dir__))
  end
end
