// ABOUTME: Defines the ClickHouse schema contract used by the root package tools.
// ABOUTME: Keeps the shared schema shape available without importing agent internals.
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
