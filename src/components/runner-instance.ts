/**
 * The self-hosted runner instance.
 */

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { type StackConfig } from '../config/schema.ts';
import { AL2023_AMI_PARAMETER, IMDS_HOP_LIMIT } from '../lib/constants.ts';
import { buildResourceName } from '../lib/naming.ts';
import { buildUserData } from '../lib/userdata.ts';

/** Where the runner lands, what it may reach, and how it registers. */
export interface RunnerPlacement {
  /** Subnet to launch into. Must have a NAT route: the instance gets no public IP. */
  readonly subnetId: pulumi.Input<string>;
  /** Security group to attach. */
  readonly securityGroupId: pulumi.Input<string>;
  /** Instance profile carrying the runner's role. */
  readonly instanceProfileName: pulumi.Input<string>;
  /** Name of the SSM parameter holding the registration token. */
  readonly parameterName: pulumi.Input<string>;
  /** Resources that must exist first. See the `dependsOn` note below. */
  readonly dependencies: readonly pulumi.Resource[];
}

/** Arguments for {@link RunnerInstance}. */
export interface RunnerInstanceArgs {
  /** Validated stack configuration. */
  readonly config: StackConfig;
  /** Tags applied to every resource in this component. */
  readonly tags: Record<string, string>;
  /** Placement and registration details. Grouped to keep this interface at three fields. */
  readonly placement: RunnerPlacement;
}

/**
 * Creates the self-hosted runner instance.
 *
 * Resolves the current Amazon Linux 2023 AMI and launches one EC2 instance whose user data installs
 * the Actions runner, reads its registration token from SSM, and registers against the configured
 * repository. No public IP, no key pair, IMDSv2 required, encrypted root volume.
 *
 * @example
 * ```ts
 * const runner = new RunnerInstance('runner', { config, tags, placement });
 * export const instanceId = runner.instanceId;
 * ```
 */
export class RunnerInstance extends pulumi.ComponentResource {
  /** The instance. */
  public readonly instance: aws.ec2.Instance;
  /** Its id, for `aws ssm start-session --target`. */
  public readonly instanceId: pulumi.Output<string>;
  /** Its private address. There is no public one, by design. */
  public readonly privateIp: pulumi.Output<string>;

  constructor(name: string, args: RunnerInstanceArgs, opts?: pulumi.ComponentResourceOptions) {
    super('nightshift:aws:RunnerInstance', name, {}, opts);

    const { config, tags, placement } = args;
    const instanceName = buildResourceName({
      prefix: config.namePrefix,
      environment: config.environment,
      resource: 'runner',
    });

    // The AWS-published alias, rather than a `getAmi` name filter: one lookup, and it cannot match
    // a third-party image that happens to satisfy a pattern.
    const ami = aws.ssm.getParameterOutput({ name: AL2023_AMI_PARAMETER }, { parent: this });
    const region = aws.getRegionOutput({}, { parent: this });

    const userData = pulumi
      .all([placement.parameterName, region.region])
      .apply(([parameterName, resolvedRegion]) =>
        buildUserData({
          repository: config.repository,
          parameterName,
          runner: {
            name: instanceName,
            group: config.runnerGroup,
            labels: config.runnerLabels,
            region: resolvedRegion,
          },
        }),
      );

    this.instance = new aws.ec2.Instance(
      `${name}-instance`,
      {
        ami: ami.value,
        instanceType: config.instanceType,
        subnetId: placement.subnetId,
        vpcSecurityGroupIds: [placement.securityGroupId],
        iamInstanceProfile: placement.instanceProfileName,
        // No public IP and no key pair: egress is via the VPC's NAT, and the only way onto the box
        // is SSM Session Manager.
        associatePublicIpAddress: false,
        metadataOptions: {
          httpEndpoint: 'enabled',
          httpTokens: 'required',
          // A hop limit of 1 stops a container on the runner from reaching the metadata service and
          // assuming this instance's role. The box exists to run arbitrary repository code, so this
          // is the security boundary rather than a nicety.
          httpPutResponseHopLimit: IMDS_HOP_LIMIT,
        },
        rootBlockDevice: {
          volumeType: 'gp3',
          volumeSize: config.rootVolumeSizeGib,
          // Encryption cannot be turned on in place later — that needs a snapshot and a replace.
          encrypted: true,
          deleteOnTermination: true,
        },
        userData,
        // Without this, editing user data only stops and starts the instance: cloud-init does not
        // re-run, and the change silently does nothing.
        userDataReplaceOnChange: true,
        tags: { ...tags, Name: instanceName },
      },
      {
        parent: this,
        // The role policies and instance profile are referenced by name, not by resource, so
        // Pulumi cannot infer these edges. Without them an instance can launch before IAM has
        // propagated the profile and fail at boot with an error that looks nothing like a race.
        dependsOn: [...placement.dependencies],
      },
    );

    this.instanceId = this.instance.id;
    this.privateIp = this.instance.privateIp;

    this.registerOutputs({
      instance: this.instance,
      instanceId: this.instanceId,
      privateIp: this.privateIp,
    });
  }
}

export default RunnerInstance;
