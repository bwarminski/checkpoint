// ABOUTME: Executes guarded EXPLAIN ANALYZE queries for candidate SQL statements.
// ABOUTME: Rejects non-SELECT input before the database receives any statement.
type Queryable = {
  query(sql: string): Promise<unknown>;
};

export class ExplainTool {
  constructor(private readonly db: Queryable) {}

  async analyze(input: { sql: string }): Promise<unknown> {
    const sql = input.sql.trim();

    if (!/^select\b/i.test(sql)) {
      throw new Error("SELECT-only queries are allowed for EXPLAIN ANALYZE");
    }

    return this.db.query(`EXPLAIN ANALYZE ${sql}`);
  }
}
