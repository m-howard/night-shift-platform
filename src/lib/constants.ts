/**
 * Named constants for the runner stack.
 *
 * This module exists because `@typescript-eslint/no-magic-numbers` permits only -1, 0, 1 and 2 as
 * literals. Every port, bound, size and pattern the stack needs is named here rather than inlined,
 * so a reader can see what a number _is_ without inferring it from context.
 */

/** Outbound HTTPS. The runner reaches GitHub, S3 and the SSM API over this and nothing else. */
export const HTTPS_PORT = 443;

/** Days an artifact survives before the bucket lifecycle rule expires it. */
export const ARTIFACT_EXPIRY_DAYS = 30;

/** Days a failed multipart upload survives before being aborted. Unaborted parts bill silently. */
export const MULTIPART_ABORT_DAYS = 7;

/** Root volume size. Actions checkouts, toolchains and a Docker image cache all land here. */
export const ROOT_VOLUME_SIZE_GIB = 64;

/**
 * IMDS hop limit. A limit of 1 stops a container on the runner from reaching the metadata service
 * and assuming the instance role — the box exists to run arbitrary repository code, so this is the
 * point of the design rather than optional hardening.
 */
export const IMDS_HOP_LIMIT = 1;

/** S3 bucket names are capped at 63 characters by AWS. */
export const MAX_BUCKET_NAME_LENGTH = 63;

/** IAM role and instance profile names are capped at 64 characters by AWS. */
export const MAX_ROLE_NAME_LENGTH = 64;

/** SSM parameter names are capped at 1011 characters, but a readable name is far shorter. */
export const MAX_PARAMETER_NAME_LENGTH = 128;

/** Root volume bounds. Below 8 GiB the AMI does not fit; above 1 TiB is a runaway config. */
export const MIN_ROOT_VOLUME_GIB = 8;
export const MAX_ROOT_VOLUME_GIB = 1024;

/** Artifact retention bounds. Zero days would delete on write; a year is the outer sane limit. */
export const MIN_EXPIRY_DAYS = 1;
export const MAX_EXPIRY_DAYS = 365;

/**
 * Pinned runner release. An unpinned `latest` download makes the instance non-reproducible: two
 * instances launched a week apart would run different runner builds with no diff to show for it.
 * Bump this deliberately, citing the release note.
 *
 * @see https://github.com/actions/runner/releases/tag/v2.336.0
 */
export const RUNNER_VERSION = '2.336.0';

/**
 * SHA-256 of `actions-runner-linux-x64-2.336.0.tar.gz`, taken from the release notes linked above.
 * The user data script verifies the download against this before extracting, because the tarball
 * is unpacked and its scripts run with root's privileges. Bump it with `RUNNER_VERSION` — a
 * mismatched pair fails the instance at boot, which is the intended fail-closed behaviour.
 */
export const RUNNER_SHA256 = '04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d';

/** The GitHub OIDC issuer. Federated workflow tokens are signed by this issuer. */
export const OIDC_PROVIDER_URL = 'https://token.actions.githubusercontent.com';

/** Issuer host, used to key the `aud`/`sub` conditions in a federated trust policy. */
export const OIDC_HOST = 'token.actions.githubusercontent.com';

/** The audience AWS STS requires GitHub's OIDC tokens to carry. */
export const OIDC_AUDIENCE = 'sts.amazonaws.com';

/**
 * Placeholder written into the registration-token parameter at create time. A human replaces the
 * value out of band; the user data script refuses to continue if it still reads this, so an
 * un-bootstrapped runner fails loudly in the console log instead of silently never registering.
 */
export const SSM_PLACEHOLDER_VALUE = 'placeholder-replace-me';

/** SSM public parameter naming the current Amazon Linux 2023 x86_64 AMI. */
export const AL2023_AMI_PARAMETER =
  '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64';

/** Managed policy granting the SSM agent what Session Manager needs. No SSH, no key pair. */
export const SSM_MANAGED_POLICY_ARN = 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore';

/** AWS resource id shapes. Both the 8- and 17-character forms are still valid in live accounts. */
export const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8}(?:[0-9a-f]{9})?$/;
export const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8}(?:[0-9a-f]{9})?$/;

/**
 * `owner/repo`. Deliberately strict: this value is interpolated into a double-quoted shell context
 * in `userdata.ts`, and this character class is what makes that interpolation safe. Loosening it
 * opens a shell-injection path in generated user data — see the note in `buildUserData`.
 */
export const REPO_SLUG_PATTERN = /^[\w.-]+\/[\w.-]+$/;

/**
 * Runner labels and group names. Same reasoning as the repository slug: these reach a shell.
 */
export const RUNNER_LABEL_PATTERN = /^[\w.-]+$/;

/** EC2 instance type, e.g. `t3.medium`. */
export const INSTANCE_TYPE_PATTERN = /^[a-z][\da-z]*\.[\da-z]+$/;

/** An IAM OIDC provider ARN, used when adopting a provider the account already has. */
export const OIDC_PROVIDER_ARN_PATTERN =
  /^arn:aws(?:-[a-z]+)*:iam::\d{12}:oidc-provider\/[\w./-]+$/;

/** Characters legal in an S3 bucket name; anything else is squeezed out when building one. */
export const BUCKET_ILLEGAL_CHARACTERS = /[^a-z0-9-]+/g;
