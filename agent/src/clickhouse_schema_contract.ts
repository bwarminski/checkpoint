// ABOUTME: Validates the ClickHouse schema contract published by the collector.
// ABOUTME: Rejects startup when the connected schema version does not match expectations.
export type ClickHouseSchemaContract = {
  schemaVersion: string;
  tables: Array<{
    columns: Array<string>;
    name: string;
  }>;
};

export async function assertSchemaContractSatisfied(input: {
  expectedVersion: string;
  introspection: ClickHouseSchemaContract;
}): Promise<void> {
  if (input.introspection.schemaVersion !== input.expectedVersion) {
    throw new Error(
      `ClickHouse schema version mismatch: expected ${input.expectedVersion}, got ${input.introspection.schemaVersion}`,
    );
  }
}
