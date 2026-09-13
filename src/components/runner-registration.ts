/**
 * The SSM parameter carrying the runner's GitHub registration token.
 *
 * Its own component, rather than part of `RunnerInstance`, because the instance role needs the
 * parameter's ARN in order to be granted read on it, and the instance needs that role. Keeping the
 * parameter separate makes the dependency chain acyclic: parameter → identity → instance.
 */

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { type StackConfig } from '../config/schema.ts';
import { SSM_PLACEHOLDER_VALUE } from '../lib/constants.ts';
import { buildParameterName } from '../lib/naming.ts';

/** Arguments for {@link RunnerRegistration}. */
export interface RunnerRegistrationArgs {
  /** Validated stack configuration. */
  readonly config: StackConfig;
  /** Tags applied to every resource in this component. */
  readonly tags: Record<string, string>;
}

/**
 * Creates the registration-token parameter.
 *
 * Creates one `aws.ssm.Parameter` of type `SecureString`, holding a placeholder. A human replaces
 * the value out of band, and subsequent deploys ignore it.
 *
 * The cost of that choice, stated plainly: Pulumi will never report that the real token has drifted
 * or expired, because it is deliberately not looking. GitHub registration tokens are valid for one
 * hour, so the token must be placed and the instance booted within that window.
 *
 * @example
 * ```ts
 * const registration = new RunnerRegistration('registration', { config, tags });
 * export const parameterName = registration.parameterName;
 * ```
 */
export class RunnerRegistration extends pulumi.ComponentResource {
  /** The parameter. */
  public readonly parameter: aws.ssm.Parameter;
  /** Its name — what a human needs for `aws ssm put-parameter`. */
  public readonly parameterName: pulumi.Output<string>;
  /** Its ARN, for the instance role's read grant. */
  public readonly parameterArn: pulumi.Output<string>;

  constructor(name: string, args: RunnerRegistrationArgs, opts?: pulumi.ComponentResourceOptions) {
    super('nightshift:aws:RunnerRegistration', name, {}, opts);

    const { config, tags } = args;

    // Created with a placeholder so `pulumi up` is a single self-contained operation rather than
    // requiring an out-of-band prerequisite a fresh clone has no way to discover. `ignoreChanges`
    // is what keeps the human-supplied token from being reverted on the next deploy.
    this.parameter = new aws.ssm.Parameter(
      `${name}-token`,
      {
        name: buildParameterName({
          prefix: config.namePrefix,
          environment: config.environment,
          resource: 'runner-registration-token',
        }),
        type: aws.ssm.ParameterType.SecureString,
        value: SSM_PLACEHOLDER_VALUE,
        description:
          'GitHub runner registration token. Replace the value by hand; tokens expire after an hour.',
        tags,
      },
      { parent: this, ignoreChanges: ['value', 'version'] },
    );

    this.parameterName = this.parameter.name;
    this.parameterArn = this.parameter.arn;

    this.registerOutputs({
      parameter: this.parameter,
      parameterName: this.parameterName,
      parameterArn: this.parameterArn,
    });
  }
}

export default RunnerRegistration;
