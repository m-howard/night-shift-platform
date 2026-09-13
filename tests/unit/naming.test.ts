import { describe, expect, it } from 'vitest';

import {
  MAX_BUCKET_NAME_LENGTH,
  MAX_PARAMETER_NAME_LENGTH,
  MAX_ROLE_NAME_LENGTH,
} from '../../src/lib/constants.ts';
import {
  buildBucketName,
  buildParameterName,
  buildResourceName,
  type ResourceNameOptions,
} from '../../src/lib/naming.ts';

const BASE: ResourceNameOptions = {
  prefix: 'night-shift',
  environment: 'dev',
  resource: 'runner',
};

describe('buildResourceName', () => {
  it('joins the parts with hyphens', () => {
    expect(buildResourceName(BASE)).toBe('night-shift-dev-runner');
  });

  it('is deterministic', () => {
    expect(buildResourceName(BASE)).toBe(buildResourceName({ ...BASE }));
  });

  it('stays within the IAM role limit even for a very long prefix', () => {
    const name = buildResourceName({ ...BASE, prefix: 'x'.repeat(200) });

    expect(name.length).toBeLessThanOrEqual(MAX_ROLE_NAME_LENGTH);
  });

  it('keeps two over-long names distinct by preserving the resource suffix', () => {
    const prefix = 'x'.repeat(200);
    const runner = buildResourceName({ ...BASE, prefix, resource: 'runner' });
    const artifacts = buildResourceName({ ...BASE, prefix, resource: 'artifacts' });

    expect(runner).not.toBe(artifacts);
    expect(runner.endsWith('runner')).toBe(true);
    expect(artifacts.endsWith('artifacts')).toBe(true);
  });
});

describe('buildBucketName', () => {
  it('builds a lowercase hyphenated name', () => {
    expect(buildBucketName({ ...BASE, resource: 'artifacts' })).toBe('night-shift-dev-artifacts');
  });

  it('lowercases an uppercase environment', () => {
    expect(buildBucketName({ ...BASE, environment: 'PROD' })).toBe('night-shift-prod-runner');
  });

  it('squeezes characters S3 does not permit', () => {
    const name = buildBucketName({ ...BASE, resource: 'build_artifacts.v2' });

    expect(name).toMatch(/^[a-z0-9-]+$/);
    expect(name).toBe('night-shift-dev-build-artifacts-v2');
  });

  it('never starts or ends with a hyphen', () => {
    const name = buildBucketName({ ...BASE, resource: '__weird__' });

    expect(name.startsWith('-')).toBe(false);
    expect(name.endsWith('-')).toBe(false);
  });

  it('stays within the S3 name limit', () => {
    const name = buildBucketName({ ...BASE, prefix: 'y'.repeat(200) });

    expect(name.length).toBeLessThanOrEqual(MAX_BUCKET_NAME_LENGTH);
  });

  it('keeps two over-long names distinct', () => {
    const prefix = 'y'.repeat(200);
    const first = buildBucketName({ ...BASE, prefix, resource: 'artifacts' });
    const second = buildBucketName({ ...BASE, prefix, resource: 'logs' });

    expect(first).not.toBe(second);
  });
});

describe('buildParameterName', () => {
  it('builds a path-shaped name with a leading slash', () => {
    expect(buildParameterName({ ...BASE, resource: 'runner-registration-token' })).toBe(
      '/night-shift/dev/runner-registration-token',
    );
  });

  it('stays within the parameter name limit', () => {
    const name = buildParameterName({ ...BASE, prefix: 'z'.repeat(400) });

    expect(name.length).toBeLessThanOrEqual(MAX_PARAMETER_NAME_LENGTH);
  });
});
