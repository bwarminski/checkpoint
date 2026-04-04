// ABOUTME: Defines the ClickHouse access point used by the DB specialist agent.
// ABOUTME: Keeps offender lookups isolated from executor orchestration logic.
export type TopOffender = {
  fingerprint: string;
  [key: string]: unknown;
};

type ClickHouseReader = {
  topOffenders(scope?: unknown): Promise<Array<TopOffender>>;
};

export class ClickHouseTool {
  constructor(private readonly reader?: ClickHouseReader) {}

  async topOffenders(scope?: unknown): Promise<Array<TopOffender>> {
    if (!this.reader) {
      return [];
    }

    return this.reader.topOffenders(scope);
  }
}
