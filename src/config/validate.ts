/**
 * Pure validation of stack configuration.
 *
 * Every function here takes plain values and returns plain values or throws `ConfigError`. No
 * Pulumi types, no AWS calls, no I/O — which is what lets `tests/unit/` reach all of it without an
 * engine or credentials.
 *
 * Several of these patterns are load-bearing for more than tidiness: `repository`, `runnerGroup`
 * and `runnerLabels` are interpolated into a double-quoted shell context by `buildUserData`, and
 * the character classes enforced here are what make that interpolation safe. Loosening them opens
 * a shell-injection path in generated user data.
 */

import { CONFIG_DEFAULTS, type RawStackConfig, type StackConfig } from './schema.ts';
import {
  INSTANCE_TYPE_PATTERN,
  MAX_EXPIRY_DAYS,
  MAX_ROOT_VOLUME_GIB,
  MIN_EXPIRY_DAYS,
  MIN_ROOT_VOLUME_GIB,
  OIDC_PROVIDER_ARN_PATTERN,
  REPO_SLUG_PATTERN,
  RUNNER_LABEL_PATTERN,
  SUBNET_ID_PATTERN,
  VPC_ID_PATTERN,
} from '../lib/constants.ts';
import { ConfigError } from '../lib/errors.ts';

/** Arguments for {@link validateBoundedInteger}. Grouped because four parameters exceeds the cap. */
export interface BoundedIntegerOptions {
  readonly key: string;
  readonly value: unknown;
  readonly min: number;
  readonly max: number;
}

/** Arguments for {@link validateStringList}. */
interface StringListOptions {
  readonly key: string;
  readonly value: unknown;
  readonly pattern: RegExp;
}

/** Returns a non-empty trimmed string, or throws naming the key. */
function validateRequiredString(key: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(key, 'is required but missing or empty');
  }

  return value.trim();
}

/** Returns `value` when it matches `pattern`, or throws naming the key and showing what it got. */
function validatePattern(key: string, value: unknown, pattern: RegExp): string {
  const text = validateRequiredString(key, value);

  if (!pattern.test(text)) {
    throw new ConfigError(key, `is malformed: "${text}" does not match ${pattern.source}`);
  }

  return text;
}

/** Validates an existing VPC id. This stack joins a VPC; it never creates one. */
export function validateVpcId(value: unknown): string {
  return validatePattern('vpcId', value, VPC_ID_PATTERN);
}

/** Validates `owner/repo`. See the shell-safety note at the top of this file. */
export function validateRepository(value: unknown): string {
  return validatePattern('repository', value, REPO_SLUG_PATTERN);
}

/** Validates an EC2 instance type such as `t3.medium`. */
export function validateInstanceType(value: unknown): string {
  return validatePattern('instanceType', value, INSTANCE_TYPE_PATTERN);
}

/** Validates a GitHub runner group name. See the shell-safety note at the top of this file. */
export function validateRunnerGroup(value: unknown): string {
  return validatePattern('runnerGroup', value, RUNNER_LABEL_PATTERN);
}

/**
 * Validates a non-empty list of strings, each matching `pattern`.
 *
 * Pulumi hands array config back as a real array, so this rejects anything else rather than trying
 * to coerce a comma-separated string — a silent coercion here would produce one subnet id named
 * `"subnet-a,subnet-b"` and an error much further downstream.
 */
function validateStringList(options: StringListOptions): readonly string[] {
  const { key, value, pattern } = options;

  if (!Array.isArray(value)) {
    throw new ConfigError(key, 'must be a list');
  }

  // `noUncheckedIndexedAccess` is on, so the first element is `unknown | undefined` rather than
  // `unknown`. Checking it is also how the empty case is caught.
  const first: unknown = value[0];

  if (first === undefined) {
    throw new ConfigError(key, 'must contain at least one entry');
  }

  return value.map((entry, index) => validatePattern(`${key}[${String(index)}]`, entry, pattern));
}

/** Validates a non-empty list of subnet ids. */
export function validateSubnetIds(value: unknown): readonly string[] {
  return validateStringList({ key: 'subnetIds', value, pattern: SUBNET_ID_PATTERN });
}

/** Validates the runner's labels. See the shell-safety note at the top of this file. */
export function validateRunnerLabels(value: unknown): readonly string[] {
  return validateStringList({ key: 'runnerLabels', value, pattern: RUNNER_LABEL_PATTERN });
}

/**
 * Validates an integer within an inclusive range.
 *
 * Accepts a number or the numeric string Pulumi's config file produces, since `pulumi config set`
 * writes every scalar as a string.
 */
export function validateBoundedInteger(options: BoundedIntegerOptions): number {
  const { key, value, min, max } = options;
  const parsed = typeof value === 'string' ? Number(value) : value;

  if (typeof parsed !== 'number' || !Number.isInteger(parsed)) {
    throw new ConfigError(key, 'must be an integer');
  }

  if (parsed < min || parsed > max) {
    throw new ConfigError(
      key,
      `must be between ${String(min)} and ${String(max)} inclusive, got ${String(parsed)}`,
    );
  }

  return parsed;
}

/** Coerces Pulumi's stringly-typed booleans, rejecting anything that is not clearly one. */
function validateBoolean(key: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true' || value === 'false') {
    return value === 'true';
  }

  // `JSON.stringify` rather than `String`: a non-scalar would otherwise render as
  // "[object Object]", which tells the reader nothing about what they actually set.
  throw new ConfigError(key, `must be true or false, got ${JSON.stringify(value)}`);
}

/** Validates the tag map, rejecting non-string values rather than stringifying them silently. */
function validateExtraTags(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError('extraTags', 'must be a map of string to string');
  }

  const validated: Record<string, string> = {};

  for (const [tagKey, tagValue] of Object.entries(value)) {
    if (typeof tagValue !== 'string') {
      throw new ConfigError('extraTags', `value for "${tagKey}" must be a string`);
    }

    validated[tagKey] = tagValue;
  }

  return validated;
}

/**
 * Resolves the OIDC provider ARN when the stack is configured to adopt an existing provider.
 *
 * Fail-closed: `createOidcProvider: false` without an ARN would otherwise produce a deploy role
 * trusting nothing, which fails at assume-role time in a workflow rather than at deploy time here.
 */
export function requireExistingProviderArn(config: StackConfig): string {
  if (config.existingOidcProviderArn === undefined) {
    throw new ConfigError(
      'existingOidcProviderArn',
      'is required when createOidcProvider is false',
    );
  }

  return config.existingOidcProviderArn;
}

/** Validates the whole configuration, applying defaults for absent optional keys. */
export function validateStackConfig(raw: RawStackConfig): StackConfig {
  const shouldCreateOidcProvider = validateBoolean(
    'createOidcProvider',
    raw.createOidcProvider,
    CONFIG_DEFAULTS.shouldCreateOidcProvider,
  );

  const existingOidcProviderArn =
    raw.existingOidcProviderArn === undefined
      ? undefined
      : validatePattern(
          'existingOidcProviderArn',
          raw.existingOidcProviderArn,
          OIDC_PROVIDER_ARN_PATTERN,
        );

  const config: StackConfig = {
    namePrefix: validatePattern(
      'namePrefix',
      raw.namePrefix ?? CONFIG_DEFAULTS.namePrefix,
      RUNNER_LABEL_PATTERN,
    ),
    environment: validatePattern(
      'environment',
      raw.environment ?? CONFIG_DEFAULTS.environment,
      RUNNER_LABEL_PATTERN,
    ),
    repository: validateRepository(raw.repository),
    vpcId: validateVpcId(raw.vpcId),
    subnetIds: validateSubnetIds(raw.subnetIds),
    instanceType: validateInstanceType(raw.instanceType ?? CONFIG_DEFAULTS.instanceType),
    rootVolumeSizeGib: validateBoundedInteger({
      key: 'rootVolumeSizeGib',
      value: raw.rootVolumeSizeGib ?? CONFIG_DEFAULTS.rootVolumeSizeGib,
      min: MIN_ROOT_VOLUME_GIB,
      max: MAX_ROOT_VOLUME_GIB,
    }),
    runnerLabels: validateRunnerLabels(raw.runnerLabels ?? CONFIG_DEFAULTS.runnerLabels),
    runnerGroup: validateRunnerGroup(raw.runnerGroup ?? CONFIG_DEFAULTS.runnerGroup),
    artifactExpiryDays: validateBoundedInteger({
      key: 'artifactExpiryDays',
      value: raw.artifactExpiryDays ?? CONFIG_DEFAULTS.artifactExpiryDays,
      min: MIN_EXPIRY_DAYS,
      max: MAX_EXPIRY_DAYS,
    }),
    shouldCreateOidcProvider,
    ...(existingOidcProviderArn === undefined ? {} : { existingOidcProviderArn }),
    extraTags: validateExtraTags(raw.extraTags),
  };

  // Surface the missing-ARN case at deploy time rather than leaving a role that trusts nothing.
  if (!shouldCreateOidcProvider) {
    requireExistingProviderArn(config);
  }

  return config;
}
