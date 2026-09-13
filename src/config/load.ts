/**
 * Adapter from `pulumi.Config` to validated {@link StackConfig}.
 *
 * Deliberately thin. Every decision — defaults, ranges, shapes, the conditional OIDC rule — lives
 * in `validate.ts`, which is pure and unit-tested. This file only reads keys, so there is almost
 * nothing here that a test cannot reach.
 */

import * as pulumi from '@pulumi/pulumi';

import { type RawStackConfig, type StackConfig } from './schema.ts';
import { validateStackConfig } from './validate.ts';

/** Config namespace. Matches the `nightshift:` prefix used in `Pulumi.<stack>.yaml`. */
const CONFIG_NAMESPACE = 'nightshift';

/**
 * Reads and validates this stack's configuration.
 *
 * Values are read untyped and handed to the validator, rather than using `getNumber`/`getBoolean`:
 * Pulumi's typed getters throw their own errors on a malformed value, which would bypass the
 * `ConfigError` messages that name the key and say how to set it.
 *
 * @param config Pulumi config reader, defaulting to this stack's namespace.
 * @returns Validated configuration, with defaults applied.
 * @throws ConfigError when a required key is absent or any value is malformed.
 */
export function loadStackConfig(config = new pulumi.Config(CONFIG_NAMESPACE)): StackConfig {
  const raw: RawStackConfig = {
    namePrefix: config.get('namePrefix'),
    environment: config.get('environment'),
    repository: config.get('repository'),
    vpcId: config.get('vpcId'),
    subnetIds: config.getObject<unknown>('subnetIds'),
    instanceType: config.get('instanceType'),
    rootVolumeSizeGib: config.get('rootVolumeSizeGib'),
    runnerLabels: config.getObject<unknown>('runnerLabels'),
    runnerGroup: config.get('runnerGroup'),
    artifactExpiryDays: config.get('artifactExpiryDays'),
    createOidcProvider: config.get('createOidcProvider'),
    existingOidcProviderArn: config.get('existingOidcProviderArn'),
    extraTags: config.getObject<unknown>('extraTags'),
  };

  return validateStackConfig(raw);
}
