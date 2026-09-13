/**
 * IAM policy documents, built as plain JSON.
 *
 * These deliberately avoid `aws.iam.getPolicyDocument`, which is an async provider invoke and so
 * unreachable from a unit test. Callers resolve any `Output` ARNs with `pulumi.all([...]).apply()`
 * and pass plain strings in; that `apply` boundary is what keeps the policy logic itself pure and
 * testable, which matters more here than anywhere else in the stack — a mistake in the OIDC trust
 * policy hands an AWS role to strangers.
 */

import { OIDC_AUDIENCE, OIDC_HOST } from './constants.ts';

/** A single statement in an IAM policy document. */
export interface PolicyStatement {
  readonly Sid?: string;
  readonly Effect: 'Allow' | 'Deny';
  readonly Action: readonly string[];
  readonly Resource?: readonly string[];
  readonly Principal?: Readonly<Record<string, string>>;
  readonly Condition?: Readonly<
    Record<string, Readonly<Record<string, string | readonly string[]>>>
  >;
}

/** An IAM policy document. */
export interface PolicyDocument {
  readonly Version: '2012-10-17';
  readonly Statement: readonly PolicyStatement[];
}

/** Arguments for {@link buildArtifactsAccessPolicy}. */
export interface ArtifactsPolicyOptions {
  /** ARN of the bucket itself, for `ListBucket`. */
  readonly bucketArn: string;
  /** ARN covering the objects within it, for the object-level actions. */
  readonly objectsArn: string;
}

/** Arguments for {@link buildParameterReadPolicy}. */
export interface ParameterReadPolicyOptions {
  /** ARN of the registration-token parameter. */
  readonly parameterArn: string;
}

/** Arguments for {@link buildOidcTrustPolicy}. */
export interface OidcTrustPolicyOptions {
  /** ARN of the IAM OIDC provider for GitHub. */
  readonly providerArn: string;
  /** Repository slug, `owner/repo`. */
  readonly repository: string;
  /**
   * Ref-scoped subject suffixes, e.g. `ref:refs/heads/main`. Each is prefixed with
   * `repo:<repository>:` so a caller cannot widen the claim beyond this repository.
   */
  readonly subjectSuffixes: readonly string[];
}

const POLICY_VERSION = '2012-10-17';

/** Trust policy letting EC2 assume the runner's instance role. */
export function buildInstanceAssumeRolePolicy(): PolicyDocument {
  return {
    Version: POLICY_VERSION,
    Statement: [
      {
        Sid: 'AllowEc2ToAssume',
        Effect: 'Allow',
        Action: ['sts:AssumeRole'],
        Principal: { Service: 'ec2.amazonaws.com' },
      },
    ],
  };
}

/**
 * Grants the runner read and write on the artifacts bucket, and nothing else.
 *
 * Object actions and the bucket-level listing are separate statements because they take different
 * resources: `s3:ListBucket` is denied if pointed at an object ARN, which is a common and
 * confusing mis-scoping.
 */
export function buildArtifactsAccessPolicy(options: ArtifactsPolicyOptions): PolicyDocument {
  return {
    Version: POLICY_VERSION,
    Statement: [
      {
        Sid: 'ReadWriteArtifactObjects',
        Effect: 'Allow',
        Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload'],
        Resource: [options.objectsArn],
      },
      {
        Sid: 'ListArtifactsBucket',
        Effect: 'Allow',
        Action: ['s3:ListBucket', 's3:ListBucketMultipartUploads'],
        Resource: [options.bucketArn],
      },
    ],
  };
}

/**
 * Grants the runner read on exactly one SSM parameter — the registration token.
 *
 * `ssm:GetParameter` is scoped to the single ARN rather than a path prefix: the instance needs one
 * value, and a prefix grant would quietly widen as unrelated parameters were added beneath it.
 * Decryption needs no explicit KMS grant because the parameter uses the AWS-managed `alias/aws/ssm`
 * key, which SSM decrypts on the caller's behalf.
 */
export function buildParameterReadPolicy(options: ParameterReadPolicyOptions): PolicyDocument {
  return {
    Version: POLICY_VERSION,
    Statement: [
      {
        Sid: 'ReadRegistrationToken',
        Effect: 'Allow',
        Action: ['ssm:GetParameter'],
        Resource: [options.parameterArn],
      },
    ],
  };
}

/**
 * Trust policy for the GitHub Actions deploy role.
 *
 * This is the most security-sensitive function in the stack. Two properties matter:
 *
 * - `aud` is matched with `StringEquals`, never `StringLike`. A wildcard-capable match on the
 *   audience is the documented route to confused-deputy access.
 * - every `sub` is anchored to `repo:<repository>:`. A `sub` of `repo:*` — or a missing `sub`
 *   condition entirely — trusts every repository on GitHub, which is to say it hands this account's
 *   role to anyone who can open a public repo.
 *
 * `tests/unit/policies.test.ts` asserts both, and those assertions are the point of the file.
 */
export function buildOidcTrustPolicy(options: OidcTrustPolicyOptions): PolicyDocument {
  const subjects = options.subjectSuffixes.map((suffix) => `repo:${options.repository}:${suffix}`);

  return {
    Version: POLICY_VERSION,
    Statement: [
      {
        Sid: 'AllowGithubActionsFederation',
        Effect: 'Allow',
        Action: ['sts:AssumeRoleWithWebIdentity'],
        Principal: { Federated: options.providerArn },
        Condition: {
          StringEquals: { [`${OIDC_HOST}:aud`]: OIDC_AUDIENCE },
          StringLike: { [`${OIDC_HOST}:sub`]: subjects },
        },
      },
    ],
  };
}
