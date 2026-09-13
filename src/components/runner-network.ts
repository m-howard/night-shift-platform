/**
 * Network placement for the runner — a security group with no way in.
 */

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { type StackConfig } from '../config/schema.ts';
import { HTTPS_PORT } from '../lib/constants.ts';
import { buildResourceName } from '../lib/naming.ts';

/** Arguments for {@link RunnerNetwork}. */
export interface RunnerNetworkArgs {
  /** Validated stack configuration, supplying the existing VPC. */
  readonly config: StackConfig;
  /** Tags applied to every resource in this component. */
  readonly tags: Record<string, string>;
}

/** Everywhere. Egress only — the runner reaches GitHub, whose addresses are not fixed. */
const ANYWHERE_IPV4 = '0.0.0.0/0';

/**
 * Creates the runner's security group.
 *
 * Creates an `aws.ec2.SecurityGroup` in the configured VPC with **no ingress rules at all**, and a
 * single egress rule permitting outbound HTTPS. Shell access is via SSM Session Manager, which
 * needs no inbound path.
 *
 * @example
 * ```ts
 * const network = new RunnerNetwork('network', { config, tags });
 * ```
 */
export class RunnerNetwork extends pulumi.ComponentResource {
  /** The security group. */
  public readonly securityGroup: aws.ec2.SecurityGroup;
  /** Its id, for attaching to an instance. */
  public readonly securityGroupId: pulumi.Output<string>;

  constructor(name: string, args: RunnerNetworkArgs, opts?: pulumi.ComponentResourceOptions) {
    super('nightshift:aws:RunnerNetwork', name, {}, opts);

    const { config, tags } = args;

    // Ingress and egress are declared as standalone rule resources rather than inline blocks;
    // mixing the two forms makes Pulumi and AWS fight over ownership of the same rules.
    this.securityGroup = new aws.ec2.SecurityGroup(
      `${name}-sg`,
      {
        name: buildResourceName({
          prefix: config.namePrefix,
          environment: config.environment,
          resource: 'runner',
        }),
        description: 'Night Shift runner: no ingress, outbound HTTPS only.',
        vpcId: config.vpcId,
        tags,
      },
      { parent: this },
    );

    // A security group created with no egress specified is given an allow-all egress rule by AWS,
    // so this restriction only exists because it is written down. Deleting it widens the group.
    new aws.vpc.SecurityGroupEgressRule(
      `${name}-egress-https`,
      {
        securityGroupId: this.securityGroup.id,
        description: 'GitHub, S3 and the SSM API. Everything the runner needs rides HTTPS.',
        ipProtocol: 'tcp',
        fromPort: HTTPS_PORT,
        toPort: HTTPS_PORT,
        cidrIpv4: ANYWHERE_IPV4,
        tags,
      },
      { parent: this },
    );

    this.securityGroupId = this.securityGroup.id;

    this.registerOutputs({
      securityGroup: this.securityGroup,
      securityGroupId: this.securityGroupId,
    });
  }
}

export default RunnerNetwork;
