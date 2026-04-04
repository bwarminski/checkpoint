// ABOUTME: Holds the future HypoPG-backed index validation entrypoint.
// ABOUTME: Stops Gate A work from assuming more validation behavior than exists.
type IndexValidator = {
  estimateBenefit(input: unknown): Promise<unknown>;
};

export class IndexValidationTool {
  constructor(private readonly validator?: IndexValidator) {}

  async estimateBenefit(input: unknown): Promise<unknown> {
    if (!this.validator) {
      throw new Error("IndexValidationTool is pending implementation.");
    }

    return this.validator.estimateBenefit(input);
  }
}
