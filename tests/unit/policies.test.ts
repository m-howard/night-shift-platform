import { describe, expect, it } from 'vitest';

import { OIDC_AUDIENCE, OIDC_HOST } from '../../src/lib/constants.ts';
import {
  buildArtifactsAccessPolicy,
  buildInstanceAssumeRolePolicy,
  buildOidcTrustPolicy,
  buildParameterReadPolicy,
  type PolicyDocument,
} from '../../src/lib/policies.ts';

const BUCKET_ARN = 'arn:aws:s3:::night-shift-dev-artifacts';
const OBJECTS_ARN = `${BUCKET_ARN}/*`;
const PARAMETER_ARN =
  'arn:aws:ssm:us-east-1:123456789012:parameter/night-shift/dev/runner-registration-token';
const PROVIDER_ARN = 'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com';

/** Every resource string mentioned anywhere in a document. */
function resourcesOf(document: PolicyDocument): string[] {
  return document.Statement.flatMap((statement) => [...(statement.Resource ?? [])]);
}

describe('buildInstanceAssumeRolePolicy', () => {
  it('trusts the EC2 service and nothing else', () => {
    const document = buildInstanceAssumeRolePolicy();

    expect(document.Statement).toHaveLength(1);
    expect(document.Statement[0]?.Principal).toEqual({ Service: 'ec2.amazonaws.com' });
    expect(document.Statement[0]?.Action).toEqual(['sts:AssumeRole']);
  });
});

describe('buildArtifactsAccessPolicy', () => {
  const document = buildArtifactsAccessPolicy({
    bucketArn: BUCKET_ARN,
    objectsArn: OBJECTS_ARN,
  });

  it('scopes every statement to this bucket', () => {
    expect(resourcesOf(document)).toEqual([OBJECTS_ARN, BUCKET_ARN]);
  });

  it('never grants a wildcard resource', () => {
    expect(resourcesOf(document)).not.toContain('*');
  });

  it('never grants a wildcard action', () => {
    const actions = document.Statement.flatMap((statement) => [...statement.Action]);

    expect(actions).not.toContain('s3:*');
    expect(actions.every((action) => !action.endsWith(':*'))).toBe(true);
  });

  it('lists against the bucket ARN, not the object ARN', () => {
    const listing = document.Statement.find((statement) =>
      statement.Action.includes('s3:ListBucket'),
    );

    expect(listing?.Resource).toEqual([BUCKET_ARN]);
  });

  it('reads and writes objects against the object ARN', () => {
    const objects = document.Statement.find((statement) =>
      statement.Action.includes('s3:PutObject'),
    );

    expect(objects?.Resource).toEqual([OBJECTS_ARN]);
  });
});

describe('buildParameterReadPolicy', () => {
  const document = buildParameterReadPolicy({ parameterArn: PARAMETER_ARN });

  it('grants read on exactly one parameter', () => {
    expect(resourcesOf(document)).toEqual([PARAMETER_ARN]);
  });

  it('does not widen to a path prefix', () => {
    expect(resourcesOf(document).some((arn) => arn.endsWith('*'))).toBe(false);
  });

  it('grants no write action', () => {
    const actions = document.Statement.flatMap((statement) => [...statement.Action]);

    expect(actions).toEqual(['ssm:GetParameter']);
  });
});

describe('buildOidcTrustPolicy', () => {
  const document = buildOidcTrustPolicy({
    providerArn: PROVIDER_ARN,
    repository: 'm-howard/night-shift',
    subjectSuffixes: ['ref:refs/heads/main'],
  });

  const condition = document.Statement[0]?.Condition;

  it('federates to the configured provider', () => {
    expect(document.Statement[0]?.Principal).toEqual({ Federated: PROVIDER_ARN });
    expect(document.Statement[0]?.Action).toEqual(['sts:AssumeRoleWithWebIdentity']);
  });

  it('matches the audience with StringEquals, never StringLike', () => {
    expect(condition?.StringEquals?.[`${OIDC_HOST}:aud`]).toBe(OIDC_AUDIENCE);
    expect(condition?.StringLike?.[`${OIDC_HOST}:aud`]).toBeUndefined();
  });

  it('constrains the subject', () => {
    expect(condition?.StringLike?.[`${OIDC_HOST}:sub`]).toEqual([
      'repo:m-howard/night-shift:ref:refs/heads/main',
    ]);
  });

  it('anchors every subject to this repository', () => {
    const wide = buildOidcTrustPolicy({
      providerArn: PROVIDER_ARN,
      repository: 'm-howard/night-shift',
      subjectSuffixes: ['ref:refs/heads/main', 'pull_request', 'environment:production'],
    });
    const subjects = wide.Statement[0]?.Condition?.StringLike?.[`${OIDC_HOST}:sub`] ?? [];

    expect(subjects).toHaveLength(3);
    for (const subject of subjects) {
      expect(subject.startsWith('repo:m-howard/night-shift:')).toBe(true);
    }
  });

  it('never produces a subject that trusts every repository', () => {
    const subjects = condition?.StringLike?.[`${OIDC_HOST}:sub`] ?? [];

    for (const subject of subjects) {
      expect(subject).not.toBe('*');
      expect(subject.startsWith('repo:*')).toBe(false);
    }
  });

  it('cannot be widened by a caller passing a wildcard suffix', () => {
    const attempted = buildOidcTrustPolicy({
      providerArn: PROVIDER_ARN,
      repository: 'm-howard/night-shift',
      subjectSuffixes: ['*'],
    });
    const subjects = attempted.Statement[0]?.Condition?.StringLike?.[`${OIDC_HOST}:sub`] ?? [];

    // A wildcard suffix still only widens within this repository, never across repositories.
    expect(subjects).toEqual(['repo:m-howard/night-shift:*']);
  });

  it('always constrains the subject at all', () => {
    expect(condition?.StringLike?.[`${OIDC_HOST}:sub`]).toBeDefined();
  });
});
