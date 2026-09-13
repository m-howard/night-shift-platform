/**
 * Deterministic resource naming.
 *
 * Pure and total: the same options always produce the same name, and nothing here reaches for
 * randomness. Physical uniqueness is Pulumi's job — it appends its own random suffix — so these
 * functions produce the readable logical part and stop there.
 */

import {
  BUCKET_ILLEGAL_CHARACTERS,
  MAX_BUCKET_NAME_LENGTH,
  MAX_PARAMETER_NAME_LENGTH,
  MAX_ROLE_NAME_LENGTH,
} from './constants.ts';

/** Arguments for the name builders. */
export interface ResourceNameOptions {
  /** Prefix shared by every resource in the stack, e.g. `night-shift`. */
  readonly prefix: string;
  /** Deployment environment, e.g. `dev`. */
  readonly environment: string;
  /** What this particular resource is, e.g. `runner` or `artifacts`. */
  readonly resource: string;
}

/**
 * Pulumi appends a random suffix to physical names, so a name clamped to exactly the AWS limit
 * would overflow once that suffix lands. Reserving room keeps the generated name legal.
 */
const PULUMI_SUFFIX_ALLOWANCE = 8;

/**
 * Truncates from the front, keeping the tail.
 *
 * The tail carries the resource name, which is the part that distinguishes two resources from each
 * other; the prefix is shared stack-wide and therefore the safe thing to lose. Truncating the other
 * way round would collapse `night-shift-dev-artifacts` and `night-shift-dev-runner` onto the same
 * string, which `naming.test.ts` asserts against.
 */
function clampToLength(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return value.slice(value.length - limit);
}

/** Joins the parts, dropping any that are empty so a name never contains a doubled separator. */
function joinParts(options: ResourceNameOptions): string {
  return [options.prefix, options.environment, options.resource]
    .filter((part) => part !== '')
    .join('-');
}

/** Builds a general-purpose resource name, clamped to the IAM role limit. */
export function buildResourceName(options: ResourceNameOptions): string {
  return clampToLength(joinParts(options), MAX_ROLE_NAME_LENGTH - PULUMI_SUFFIX_ALLOWANCE);
}

/**
 * Builds an S3 bucket name.
 *
 * Bucket names live in a global namespace and accept only lowercase alphanumerics and hyphens, so
 * this lowercases, squeezes out everything else, and trims stray leading or trailing hyphens that
 * squeezing can leave behind.
 */
export function buildBucketName(options: ResourceNameOptions): string {
  const squeezed = joinParts(options)
    .toLowerCase()
    .replace(BUCKET_ILLEGAL_CHARACTERS, '-')
    .replace(/-{2,}/g, '-');

  const clamped = clampToLength(squeezed, MAX_BUCKET_NAME_LENGTH - PULUMI_SUFFIX_ALLOWANCE);

  return clamped.replace(/^-+/, '').replace(/-+$/, '');
}

/**
 * Builds an SSM parameter name.
 *
 * Parameter names are path-shaped, and the leading slash is required for anything but the simplest
 * flat namespace.
 */
export function buildParameterName(options: ResourceNameOptions): string {
  const path = `/${options.prefix}/${options.environment}/${options.resource}`;

  return clampToLength(path, MAX_PARAMETER_NAME_LENGTH);
}
