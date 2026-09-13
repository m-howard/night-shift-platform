/**
 * GitHub Actions OIDC federation — the provider and the role workflows assume.
 */

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { type StackConfig } from '../config/schema.ts';
import { requireExistingProviderArn } from '../config/validate.ts';
import { OIDC_AUDIENCE, OIDC_PROVIDER_URL } from '../lib/constants.ts';
import { buildResourceName } from '../lib/naming.ts';
import { buildOidcTrustPolicy } from '../lib/policies.ts';

/** Arguments for {@link GithubOidc}. */
export interface GithubOidcArgs {
  /** Validated stack configuration. */
  readonly config: StackConfig;
  /** Tags applied to every resource in this component. */
  readonly tags: Record<string, string>;
}

/**
 * Subjects permitted to assume the deploy role.
 *
 * Deliberately narrow: pushes to the default branch only. A pull request from a fork carries
 * `pull_request` rather than a branch ref, so this deliberately does not let untrusted PR code
 * assume the role — the trap `AGENTS.md` names explicitly.
 */
const DEPLOY_SUBJECT_SUFFIXES = ['ref:refs/heads/main'];

/**
 * Creates GitHub OIDC federation into this account.
 *
 * Creates an `aws.iam.OpenIdConnectProvider` — unless the account already has one, in which case
 * `createOidcProvider: false` adopts it by ARN — and an `aws.iam.Role` trusting only this
 * repository's default branch. The role carries `ReadOnlyAccess` as a starting point; widen it
 * deliberately when a workflow needs to write.
 *
 * @example
 * ```ts
 * const oidc = new GithubOidc('oidc', { config, tags });
 * export const deployRoleArn = oidc.deployRoleArn;
 * ```
 */
export class GithubOidc extends pulumi.ComponentResource {
  /** ARN of the OIDC provider, whether created here or adopted. */
  public readonly providerArn: pulumi.Output<string>;
  /** The role a workflow assumes. */
  public readonly deployRole: aws.iam.Role;
  /** Its ARN — what `configure-aws-credentials` needs. */
  public readonly deployRoleArn: pulumi.Output<string>;

  constructor(name: string, args: GithubOidcArgs, opts?: pulumi.ComponentResourceOptions) {
    super('nightshift:aws:GithubOidc', name, {}, opts);

    const { config, tags } = args;

    // An account may hold only one provider per issuer URL, and a second `create` fails with
    // EntityAlreadyExists. The flag is explicit rather than a lookup-or-create because an invoke
    // that fails when the provider is absent cannot express "create it then".
    //
    // `thumbprintLists` is deliberately omitted: AWS validates GitHub's issuer against its own
    // trusted CAs and ignores any thumbprint supplied here. Setting one is also a one-way door —
    // removing it later does not restore automatic retrieval.
    this.providerArn = config.shouldCreateOidcProvider
      ? new aws.iam.OpenIdConnectProvider(
          `${name}-provider`,
          { url: OIDC_PROVIDER_URL, clientIdLists: [OIDC_AUDIENCE], tags },
          { parent: this },
        ).arn
      : pulumi.output(requireExistingProviderArn(config));

    this.deployRole = new aws.iam.Role(
      `${name}-deploy-role`,
      {
        name: buildResourceName({
          prefix: config.namePrefix,
          environment: config.environment,
          resource: 'deploy',
        }),
        description: `GitHub Actions deploy role for ${config.repository}.`,
        assumeRolePolicy: this.providerArn.apply((providerArn) =>
          JSON.stringify(
            buildOidcTrustPolicy({
              providerArn,
              repository: config.repository,
              subjectSuffixes: DEPLOY_SUBJECT_SUFFIXES,
            }),
          ),
        ),
        tags,
      },
      { parent: this },
    );

    // Read-only until a workflow demonstrably needs more. Widening this is a reviewed change with
    // a stated blast radius, which is the point of starting here rather than at PowerUserAccess.
    new aws.iam.RolePolicyAttachment(
      `${name}-deploy-readonly`,
      { role: this.deployRole.name, policyArn: aws.iam.ManagedPolicy.ReadOnlyAccess },
      { parent: this },
    );

    this.deployRoleArn = this.deployRole.arn;

    this.registerOutputs({
      providerArn: this.providerArn,
      deployRole: this.deployRole,
      deployRoleArn: this.deployRoleArn,
    });
  }
}

export default GithubOidc;
