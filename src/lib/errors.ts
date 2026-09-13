/**
 * Configuration errors for the runner stack.
 *
 * Fail-closed, and the message names the key. This mirrors `tests/helpers/env.ts`: the alternative
 * — falling back to a default when configuration looks absent — deploys infrastructure nobody
 * asked for into an account nobody chose, which is the failure mode an auto-deploy pipeline must
 * not have.
 */

/** Raised when a Pulumi config value is missing, malformed or out of range. */
export class ConfigError extends Error {
  /** The config key at fault, without its namespace. */
  public readonly key: string;

  constructor(key: string, reason: string) {
    super(
      `Config key "${key}" ${reason}. Set it with \`pulumi config set nightshift:${key} <value>\`, ` +
        `or see Pulumi.dev.yaml and README.md for what this stack expects.`,
    );

    this.name = 'ConfigError';
    this.key = key;
  }
}
