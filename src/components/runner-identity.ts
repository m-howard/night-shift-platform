/**
 * IAM identity for the runner instance — role, scoped policies and instance profile.
 */

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { type StackConfig } from '../config/schema.ts';
import { SSM_MANAGED_POLICY_ARN } from '../lib/constants.ts';
import { buildResourceName } from '../lib/naming.ts';
import {
  buildArtifactsAccessPolicy,
  buildInstanceAssumeRolePolicy,
  buildParameterReadPolicy,
} from '../lib/policies.ts';

/** The resources the runner is permitted to reach. */
export interface IdentityGrants {
  /** ARN of the artifacts bucket. */
  readonly bucketArn: pulumi.Input<string>;
  /** ARN covering objects in the artifacts bucket. */
  readonly objectsArn: pulumi.Input<string>;
  /** ARN of the SSM parameter holding the registration token. */
  readonly parameterArn: pulumi.Input<string>;
}

/** Arguments for {@link RunnerIdentity}. */
export interface RunnerIdentityArgs {
  /** Validated stack configuration. */
  readonly config: StackConfig;
  /** Tags applied to every resource in this component. */
  readonly tags: Record<string, string>;
  /** What this identity may reach. Grouped to keep this interface at three fields. */
  readonly grants: IdentityGrants;
}

/**
 * Creates the runner's IAM identity.
 *
 * Creates an `aws.iam.Role` assumable by EC2, an attachment of `AmazonSSMManagedInstanceCore` (the
 * whole of the runner's shell access — no key pair, no SSH), two inline policies scoped to exactly
 * the artifacts bucket and the one registration-token parameter, and the instance profile that
 * carries the role onto the instance.
 *
 * @example
 * ```ts
 * const identity = new RunnerIdentity('identity', { config, tags, grants });
 * ```
 */
export class RunnerIdentity extends pulumi.ComponentResource {
  /** The instance role. */
  public readonly role: aws.iam.Role;
  /** Its ARN. */
  public readonly roleArn: pulumi.Output<string>;
  /** The instance profile wrapping the role. */
  public readonly instanceProfile: aws.iam.InstanceProfile;
  /** Its name, for the EC2 instance. */
  public readonly instanceProfileName: pulumi.Output<string>;

  constructor(name: string, args: RunnerIdentityArgs, opts?: pulumi.ComponentResourceOptions) {
    super('nightshift:aws:RunnerIdentity', name, {}, opts);

    const { config, tags, grants } = args;
    const roleName = buildResourceName({
      prefix: config.namePrefix,
      environment: config.environment,
      resource: 'runner',
    });

    this.role = new aws.iam.Role(
      `${name}-role`,
      {
        name: roleName,
        description: 'Night Shift self-hosted runner instance role.',
        assumeRolePolicy: JSON.stringify(buildInstanceAssumeRolePolicy()),
        tags,
      },
      { parent: this },
    );

    // Session Manager, and with it every route onto the box. The instance has no key pair and the
    // security group has no ingress, so removing this attachment locks the runner out entirely.
    new aws.iam.RolePolicyAttachment(
      `${name}-ssm-core`,
      { role: this.role.name, policyArn: SSM_MANAGED_POLICY_ARN },
      { parent: this },
    );

    // The `apply` is the boundary between Pulumi's async world and the pure, unit-tested policy
    // builders: ARNs resolve here, and the document itself is built by a function a test can call.
    new aws.iam.RolePolicy(
      `${name}-artifacts`,
      {
        role: this.role.id,
        policy: pulumi
          .all([grants.bucketArn, grants.objectsArn])
          .apply(([bucketArn, objectsArn]) =>
            JSON.stringify(buildArtifactsAccessPolicy({ bucketArn, objectsArn })),
          ),
      },
      { parent: this },
    );

    new aws.iam.RolePolicy(
      `${name}-registration-token`,
      {
        role: this.role.id,
        policy: pulumi
          .output(grants.parameterArn)
          .apply((parameterArn) => JSON.stringify(buildParameterReadPolicy({ parameterArn }))),
      },
      { parent: this },
    );

    this.instanceProfile = new aws.iam.InstanceProfile(
      `${name}-profile`,
      { name: roleName, role: this.role.name, tags },
      { parent: this },
    );

    this.roleArn = this.role.arn;
    this.instanceProfileName = this.instanceProfile.name;

    this.registerOutputs({
      role: this.role,
      roleArn: this.roleArn,
      instanceProfile: this.instanceProfile,
      instanceProfileName: this.instanceProfileName,
    });
  }
}

export default RunnerIdentity;
