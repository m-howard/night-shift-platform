/**
 * Night Shift — bootstrap runner infrastructure.
 *
 * One self-hosted GitHub Actions runner in an existing VPC, the S3 bucket it writes artifacts to,
 * and the GitHub OIDC federation that lets workflows reach AWS without static credentials.
 *
 * The runner registers using a token a human places in SSM after the first deploy; see the bootstrap
 * section of README.md. Everything here is deliberately small — this is the fleet's first instance,
 * not the fleet.
 */

import { ArtifactsBucket } from './components/artifacts-bucket.ts';
import { GithubOidc } from './components/github-oidc.ts';
import { RunnerIdentity } from './components/runner-identity.ts';
import { RunnerInstance } from './components/runner-instance.ts';
import { RunnerNetwork } from './components/runner-network.ts';
import { RunnerRegistration } from './components/runner-registration.ts';
import { loadStackConfig } from './config/load.ts';
import { ConfigError } from './lib/errors.ts';
import { buildTags } from './lib/tagging.ts';

const config = loadStackConfig();

const artifacts = new ArtifactsBucket('artifacts', {
  config,
  tags: buildTags({ config, component: 'artifacts' }),
});

const registration = new RunnerRegistration('registration', {
  config,
  tags: buildTags({ config, component: 'registration' }),
});

const network = new RunnerNetwork('network', {
  config,
  tags: buildTags({ config, component: 'network' }),
});

const oidc = new GithubOidc('oidc', {
  config,
  tags: buildTags({ config, component: 'oidc' }),
});

const identity = new RunnerIdentity('identity', {
  config,
  tags: buildTags({ config, component: 'identity' }),
  grants: {
    bucketArn: artifacts.bucketArn,
    objectsArn: artifacts.objectsArn,
    parameterArn: registration.parameterArn,
  },
});

// `validateSubnetIds` rejects an empty list, but `noUncheckedIndexedAccess` still types the first
// element as possibly undefined. Fail closed rather than substituting a fallback: a wrong subnet id
// would launch the runner somewhere nobody chose.
const firstSubnetId = config.subnetIds[0];

if (firstSubnetId === undefined) {
  throw new ConfigError('subnetIds', 'must contain at least one entry');
}

const runner = new RunnerInstance('runner', {
  config,
  tags: buildTags({ config, component: 'runner' }),
  placement: {
    subnetId: firstSubnetId,
    securityGroupId: network.securityGroupId,
    instanceProfileName: identity.instanceProfileName,
    parameterName: registration.parameterName,
    dependencies: [identity.instanceProfile, registration.parameter],
  },
});

/** Instance id, for `aws ssm start-session --target`. */
export const runnerInstanceId = runner.instanceId;
/** The runner's private address. There is no public one. */
export const runnerPrivateIp = runner.privateIp;
/** Security group protecting the runner. */
export const runnerSecurityGroupId = network.securityGroupId;
/** The instance role the runner assumes. */
export const runnerRoleArn = identity.roleArn;
/** Bucket holding job artifacts and build cache. */
export const artifactsBucketName = artifacts.bucketName;
/** Its ARN. */
export const artifactsBucketArn = artifacts.bucketArn;
/**
 * The parameter a human must populate to finish the bootstrap. The token itself is never exported —
 * stack outputs are readable by anyone who can read the state.
 */
export const registrationParameterName = registration.parameterName;
/** The GitHub OIDC provider, created or adopted. */
export const oidcProviderArn = oidc.providerArn;
/** Role a workflow assumes via OIDC. */
export const deployRoleArn = oidc.deployRoleArn;
