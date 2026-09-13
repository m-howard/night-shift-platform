import { describe, expect, it } from 'vitest';

import { validateStackConfig } from '../../src/config/validate.ts';
import { buildTags } from '../../src/lib/tagging.ts';

const config = validateStackConfig({
  repository: 'm-howard/night-shift',
  vpcId: 'vpc-0a1b2c3d',
  subnetIds: ['subnet-0a1b2c3d'],
  environment: 'prod',
  extraTags: { CostCentre: 'platform' },
});

describe('buildTags', () => {
  it('always emits the mandatory keys', () => {
    const tags = buildTags({ config, component: 'runner' });

    expect(tags).toMatchObject({
      Project: 'night-shift',
      Environment: 'prod',
      Component: 'runner',
      Repository: 'm-howard/night-shift',
      ManagedBy: 'pulumi',
    });
  });

  it('carries the operator tags through', () => {
    expect(buildTags({ config, component: 'runner' }).CostCentre).toBe('platform');
  });

  it('merges per-resource extras', () => {
    const tags = buildTags({ config, component: 'artifacts', extra: { Retention: '30d' } });

    expect(tags.Retention).toBe('30d');
    expect(tags.Component).toBe('artifacts');
  });

  it('does not let extras displace a mandatory key', () => {
    const tags = buildTags({
      config,
      component: 'runner',
      extra: { ManagedBy: 'somebody-else', Project: 'other' },
    });

    expect(tags.ManagedBy).toBe('pulumi');
    expect(tags.Project).toBe('night-shift');
  });

  it('does not let operator config displace a mandatory key either', () => {
    const hostile = validateStackConfig({
      repository: 'm-howard/night-shift',
      vpcId: 'vpc-0a1b2c3d',
      subnetIds: ['subnet-0a1b2c3d'],
      extraTags: { ManagedBy: 'terraform' },
    });

    expect(buildTags({ config: hostile, component: 'runner' }).ManagedBy).toBe('pulumi');
  });

  it('distinguishes components so a bill can be split by one', () => {
    expect(buildTags({ config, component: 'runner' }).Component).not.toBe(
      buildTags({ config, component: 'artifacts' }).Component,
    );
  });
});
