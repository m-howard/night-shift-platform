import { describe, expect, it } from 'vitest';

import { CONFIG_DEFAULTS, type RawStackConfig } from '../../src/config/schema.ts';
import {
  requireExistingProviderArn,
  validateBoundedInteger,
  validateRepository,
  validateStackConfig,
  validateSubnetIds,
  validateVpcId,
} from '../../src/config/validate.ts';
import { ConfigError } from '../../src/lib/errors.ts';

/** The minimum a caller must supply; everything else has a default. */
const REQUIRED: RawStackConfig = {
  repository: 'm-howard/night-shift',
  vpcId: 'vpc-0a1b2c3d',
  subnetIds: ['subnet-0a1b2c3d'],
};

describe('validateVpcId', () => {
  it.each(['vpc-0a1b2c3d', 'vpc-0a1b2c3d4e5f60718'])('accepts %s', (value) => {
    expect(validateVpcId(value)).toBe(value);
  });

  it.each([
    ['a subnet id', 'subnet-0a1b2c3d'],
    ['no prefix', '0a1b2c3d'],
    ['uppercase hex', 'vpc-0A1B2C3D'],
    ['too short', 'vpc-0a1b'],
    ['empty', ''],
    ['a number', 42],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(() => validateVpcId(value)).toThrow(ConfigError);
  });

  it('names the key in the error', () => {
    expect(() => validateVpcId('nope')).toThrow(/vpcId/);
  });
});

describe('validateRepository', () => {
  it.each(['m-howard/night-shift', 'owner/repo.name', 'a_b/c-d'])('accepts %s', (value) => {
    expect(validateRepository(value)).toBe(value);
  });

  it.each([
    ['no slash', 'night-shift'],
    ['two slashes', 'a/b/c'],
    ['a space', 'owner/repo name'],
    ['a shell metacharacter', 'owner/repo;rm -rf /'],
    ['command substitution', 'owner/$(whoami)'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(() => validateRepository(value)).toThrow(ConfigError);
  });
});

describe('validateSubnetIds', () => {
  it('accepts a populated list', () => {
    expect(validateSubnetIds(['subnet-0a1b2c3d', 'subnet-1a2b3c4d'])).toEqual([
      'subnet-0a1b2c3d',
      'subnet-1a2b3c4d',
    ]);
  });

  it('rejects an empty list', () => {
    expect(() => validateSubnetIds([])).toThrow(/at least one/);
  });

  it('rejects a comma-separated string rather than splitting it', () => {
    expect(() => validateSubnetIds('subnet-0a1b2c3d,subnet-1a2b3c4d')).toThrow(/must be a list/);
  });

  it('names the offending index', () => {
    expect(() => validateSubnetIds(['subnet-0a1b2c3d', 'not-a-subnet'])).toThrow(/subnetIds\[1\]/);
  });
});

describe('validateBoundedInteger', () => {
  const options = { key: 'rootVolumeSizeGib', min: 8, max: 1024 };

  it.each([8, 64, 1024])('accepts %d inside the inclusive range', (value) => {
    expect(validateBoundedInteger({ ...options, value })).toBe(value);
  });

  it('accepts the numeric strings pulumi config writes', () => {
    expect(validateBoundedInteger({ ...options, value: '64' })).toBe(64);
  });

  it.each([7, 1025, -1])('rejects %d outside the range', (value) => {
    expect(() => validateBoundedInteger({ ...options, value })).toThrow(/between 8 and 1024/);
  });

  it.each([
    ['a fraction', 1.5],
    ['a non-numeric string', 'sixty-four'],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(() => validateBoundedInteger({ ...options, value })).toThrow(/must be an integer/);
  });
});

describe('validateStackConfig', () => {
  it('applies defaults for every absent optional key', () => {
    const config = validateStackConfig(REQUIRED);

    expect(config.namePrefix).toBe(CONFIG_DEFAULTS.namePrefix);
    expect(config.environment).toBe(CONFIG_DEFAULTS.environment);
    expect(config.instanceType).toBe(CONFIG_DEFAULTS.instanceType);
    expect(config.rootVolumeSizeGib).toBe(CONFIG_DEFAULTS.rootVolumeSizeGib);
    expect(config.runnerGroup).toBe(CONFIG_DEFAULTS.runnerGroup);
    expect(config.artifactExpiryDays).toBe(CONFIG_DEFAULTS.artifactExpiryDays);
    expect(config.runnerLabels).toEqual([...CONFIG_DEFAULTS.runnerLabels]);
    expect(config.shouldCreateOidcProvider).toBe(true);
    expect(config.extraTags).toEqual({});
    expect(config.existingOidcProviderArn).toBeUndefined();
  });

  it.each(['repository', 'vpcId', 'subnetIds'] as const)('requires %s', (key) => {
    const raw = { ...REQUIRED, [key]: undefined };

    expect(() => validateStackConfig(raw)).toThrow(ConfigError);
  });

  it('coerces the stringly-typed booleans pulumi config writes', () => {
    const config = validateStackConfig({
      ...REQUIRED,
      createOidcProvider: 'false',
      existingOidcProviderArn:
        'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com',
    });

    expect(config.shouldCreateOidcProvider).toBe(false);
  });

  it('rejects a boolean that is neither true nor false', () => {
    expect(() => validateStackConfig({ ...REQUIRED, createOidcProvider: 'yes' })).toThrow(
      /must be true or false/,
    );
  });

  it('fails closed when adopting a provider without supplying its ARN', () => {
    expect(() => validateStackConfig({ ...REQUIRED, createOidcProvider: false })).toThrow(
      /existingOidcProviderArn/,
    );
  });

  it('accepts adopting a provider when the ARN is supplied', () => {
    const arn = 'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com';
    const config = validateStackConfig({
      ...REQUIRED,
      createOidcProvider: false,
      existingOidcProviderArn: arn,
    });

    expect(config.existingOidcProviderArn).toBe(arn);
  });

  it('rejects a malformed provider ARN', () => {
    expect(() =>
      validateStackConfig({
        ...REQUIRED,
        createOidcProvider: false,
        existingOidcProviderArn: 'not-an-arn',
      }),
    ).toThrow(/existingOidcProviderArn/);
  });

  it('rejects non-string tag values rather than stringifying them', () => {
    expect(() => validateStackConfig({ ...REQUIRED, extraTags: { CostCentre: 42 } })).toThrow(
      /must be a string/,
    );
  });

  it('rejects a label carrying shell metacharacters', () => {
    expect(() => validateStackConfig({ ...REQUIRED, runnerLabels: ['ok', 'evil;reboot'] })).toThrow(
      ConfigError,
    );
  });
});

describe('requireExistingProviderArn', () => {
  it('throws naming the key when the ARN is absent', () => {
    const config = validateStackConfig(REQUIRED);

    expect(() => requireExistingProviderArn(config)).toThrow(/existingOidcProviderArn/);
  });
});
