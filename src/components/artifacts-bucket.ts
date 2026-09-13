/**
 * S3 artifacts bucket — build cache and job artifacts for the runner fleet.
 */

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { type StackConfig } from '../config/schema.ts';
import { MULTIPART_ABORT_DAYS } from '../lib/constants.ts';
import { buildBucketName } from '../lib/naming.ts';

/** Arguments for {@link ArtifactsBucket}. */
export interface ArtifactsBucketArgs {
  /** Validated stack configuration. */
  readonly config: StackConfig;
  /** Tags applied to every resource in this component. */
  readonly tags: Record<string, string>;
}

/**
 * Creates the artifacts bucket and the four resources that make it safe to use.
 *
 * Creates:
 * - an `aws.s3.Bucket` named from the stack prefix and environment
 * - a public access block with all four protections on
 * - SSE-S3 (`AES256`) default encryption
 * - versioning explicitly `Suspended`
 * - ownership controls set to `BucketOwnerEnforced`, which disables ACLs outright
 * - a lifecycle rule expiring artifacts and aborting stalled multipart uploads
 *
 * @example
 * ```ts
 * const artifacts = new ArtifactsBucket('artifacts', { config, tags });
 * export const bucket = artifacts.bucketName;
 * ```
 */
export class ArtifactsBucket extends pulumi.ComponentResource {
  /** The bucket itself. */
  public readonly bucket: aws.s3.Bucket;
  /** Physical bucket name. */
  public readonly bucketName: pulumi.Output<string>;
  /** ARN of the bucket, for `s3:ListBucket`. */
  public readonly bucketArn: pulumi.Output<string>;
  /** ARN covering objects in the bucket, for object-level actions. */
  public readonly objectsArn: pulumi.Output<string>;

  constructor(name: string, args: ArtifactsBucketArgs, opts?: pulumi.ComponentResourceOptions) {
    super('nightshift:aws:ArtifactsBucket', name, {}, opts);

    const { config, tags } = args;

    this.bucket = new aws.s3.Bucket(
      `${name}-bucket`,
      {
        bucket: buildBucketName({
          prefix: config.namePrefix,
          environment: config.environment,
          resource: 'artifacts',
        }),
        tags,
      },
      { parent: this },
    );

    new aws.s3.BucketPublicAccessBlock(
      `${name}-public-access-block`,
      {
        bucket: this.bucket.id,
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
      { parent: this },
    );

    // SSE-S3 rather than SSE-KMS: a cache bucket makes a great many small requests, and KMS bills
    // per request. Revisit only if a compliance requirement demands a customer-managed key.
    new aws.s3.BucketServerSideEncryptionConfiguration(
      `${name}-encryption`,
      {
        bucket: this.bucket.id,
        rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: 'AES256' } }],
      },
      { parent: this },
    );

    // Set explicitly rather than left at the default so the decision is visible in code. These are
    // regenerable, high-churn objects; versioning would multiply storage cost to protect artifacts
    // that are cheaper to rebuild than to retain.
    new aws.s3.BucketVersioning(
      `${name}-versioning`,
      {
        bucket: this.bucket.id,
        versioningConfiguration: { status: 'Suspended' },
      },
      { parent: this },
    );

    // BucketOwnerEnforced disables ACLs entirely, so object ownership cannot drift to a writer.
    new aws.s3.BucketOwnershipControls(
      `${name}-ownership`,
      {
        bucket: this.bucket.id,
        rule: { objectOwnership: 'BucketOwnerEnforced' },
      },
      { parent: this },
    );

    // An empty `filter` is what makes the rule apply to the whole bucket; omitting it entirely is
    // rejected. The multipart abort matters as much as the expiry: failed uploads are invisible in
    // the console and bill until something removes them.
    new aws.s3.BucketLifecycleConfiguration(
      `${name}-lifecycle`,
      {
        bucket: this.bucket.id,
        rules: [
          {
            id: 'expire-artifacts',
            status: 'Enabled',
            filter: {},
            expiration: { days: config.artifactExpiryDays },
            abortIncompleteMultipartUpload: { daysAfterInitiation: MULTIPART_ABORT_DAYS },
          },
        ],
      },
      { parent: this },
    );

    this.bucketName = this.bucket.bucket;
    this.bucketArn = this.bucket.arn;
    this.objectsArn = pulumi.interpolate`${this.bucket.arn}/*`;

    this.registerOutputs({
      bucket: this.bucket,
      bucketName: this.bucketName,
      bucketArn: this.bucketArn,
      objectsArn: this.objectsArn,
    });
  }
}

export default ArtifactsBucket;
