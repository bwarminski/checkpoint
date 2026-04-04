# ABOUTME: Verifies the ClickHouse schema files for the query collector.
# ABOUTME: Guards the materialized view definition against embedding ORDER BY.
require "minitest/autorun"

class ClickhouseSchemaTest < Minitest::Test
  def test_materialized_view_does_not_embed_order_by
    sql = File.read("db/clickhouse/003_top_offenders_mv.sql")

    refute_match(/\bORDER BY\b/i, sql)
    assert_includes sql, "CREATE MATERIALIZED VIEW"
  end
end
