# ABOUTME: Verifies the ClickHouse schema files for the query collector.
# ABOUTME: Guards the materialized view definition against embedding ORDER BY.
require "minitest/autorun"

class ClickhouseSchemaTest < Minitest::Test
  def test_materialized_view_does_not_embed_order_by
    sql = read_sql("003_top_offenders_mv.sql")

    refute_match(/\bORDER BY\b/i, sql)
    assert_includes sql, "CREATE MATERIALIZED VIEW"
    refute_match(/\banyState\b/i, sql)
    assert_includes sql, "argMaxState((source_tag, source_file, sample_query), collected_at) AS representative_state"
  end

  def test_fingerprint_table_uses_a_single_representative_row_state
    sql = read_sql("002_query_fingerprints.sql")

    assert_includes sql, "representative_state AggregateFunction(argMax, Tuple(Nullable(String), Nullable(String), Nullable(String)), DateTime64(3))"
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
