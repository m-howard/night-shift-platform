/**
 * The shape of this stack's configuration, and the defaults applied when a key is absent.
 *
 * `RawStackConfig` is what arrives from `pulumi.Config` — every field `unknown`, because Pulumi
 * hands back strings and untyped objects. `StackConfig` is what the rest of the stack consumes,
 * produced only by `validateStackConfig`. Nothing constructs a `StackConfig` by hand.
 */

import { ARTIFACT_EXPIRY_DAYS, ROOT_VOLUME_SIZE_GIB } from '../lib/constants.ts';

/** Validated configuration. Every field is present and in range by construction. */
export interface StackConfig {
  /** Prefix for every resource name, e.g. `night-shift`. */
  readonly namePrefix: string;
  /** Deployment environment, e.g. `dev`. Part of resource names and the `Environment` tag. */
  readonly environment: string;
  /** The repository the runner registers against, as `owner/repo`. */
  readonly repository: string;
  /** Existing VPC the runner joins. This stack never creates a VPC. */
  readonly vpcId: string;
  /** Existing subnets. Must have a NAT route: the runner gets no public IP. */
  readonly subnetIds: readonly string[];
  /** EC2 instance type for the runner. */
  readonly instanceType: string;
  /** Root EBS volume size in GiB. */
  readonly rootVolumeSizeGib: number;
  /** Labels the runner registers with, used by `runs-on`. */
  readonly runnerLabels: readonly string[];
  /** GitHub runner group the runner joins. */
  readonly runnerGroup: string;
  /** Days an artifact survives in the bucket before lifecycle expiry. */
  readonly artifactExpiryDays: number;
  /** Whether to create the GitHub OIDC provider, or adopt one the account already has. */
  readonly shouldCreateOidcProvider: boolean;
  /** ARN of an existing OIDC provider. Required when `shouldCreateOidcProvider` is false. */
  readonly existingOidcProviderArn?: string;
  /** Additional tags merged onto every resource. */
  readonly extraTags: Readonly<Record<string, string>>;
}

/** Configuration as read from `pulumi.Config`, before validation. */
export interface RawStackConfig {
  readonly namePrefix?: unknown;
  readonly environment?: unknown;
  readonly repository?: unknown;
  readonly vpcId?: unknown;
  readonly subnetIds?: unknown;
  readonly instanceType?: unknown;
  readonly rootVolumeSizeGib?: unknown;
  readonly runnerLabels?: unknown;
  readonly runnerGroup?: unknown;
  readonly artifactExpiryDays?: unknown;
  readonly createOidcProvider?: unknown;
  readonly existingOidcProviderArn?: unknown;
  readonly extraTags?: unknown;
}

/**
 * Values used when a key is absent. Only optional keys appear here — `repository`, `vpcId` and
 * `subnetIds` have no sensible default, so their absence is an error rather than a fallback.
 */
export const CONFIG_DEFAULTS = {
  namePrefix: 'night-shift',
  environment: 'dev',
  instanceType: 't3.medium',
  rootVolumeSizeGib: ROOT_VOLUME_SIZE_GIB,
  runnerLabels: ['self-hosted', 'linux', 'x64', 'night-shift'],
  runnerGroup: 'Default',
  artifactExpiryDays: ARTIFACT_EXPIRY_DAYS,
  shouldCreateOidcProvider: true,
} as const;
