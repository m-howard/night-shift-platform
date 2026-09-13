import { describe, expect, it } from 'vitest';

import { RUNNER_SHA256, RUNNER_VERSION, SSM_PLACEHOLDER_VALUE } from '../../src/lib/constants.ts';
import { buildUserData, type UserDataOptions } from '../../src/lib/userdata.ts';

const OPTIONS: UserDataOptions = {
  repository: 'm-howard/night-shift',
  parameterName: '/night-shift/dev/runner-registration-token',
  runner: {
    name: 'night-shift-dev-runner',
    group: 'Default',
    labels: ['self-hosted', 'linux', 'x64', 'night-shift'],
    region: 'us-east-1',
  },
};

const script = buildUserData(OPTIONS);

describe('buildUserData', () => {
  it('is a bash script that fails fast', () => {
    expect(script.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(script).toContain('set -euo pipefail');
  });

  it('is deterministic', () => {
    expect(buildUserData(OPTIONS)).toBe(script);
  });

  it('installs the prerequisites the runner silently needs', () => {
    expect(script).toContain('libicu');
    expect(script).toContain('tar');
  });

  it('does not configure the runner as root', () => {
    expect(script).toContain('useradd');
    expect(script).toContain('sudo -u runner');
  });

  it('pins the runner version rather than fetching latest', () => {
    expect(script).toContain(`actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz`);
    expect(script).not.toContain('/latest/');
  });

  it('verifies the download before extracting it', () => {
    expect(script).toContain(RUNNER_SHA256);
    expect(script).toContain('sha256sum --check');

    const verifyAt = script.indexOf('sha256sum --check');
    const extractAt = script.indexOf('tar -xzf');

    expect(verifyAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(extractAt);
  });

  it('bounds every download so a missing NAT route fails instead of hanging', () => {
    expect(script).toContain('--max-time');
  });

  it('reads the registration token from SSM with decryption', () => {
    expect(script).toContain('aws ssm get-parameter');
    expect(script).toContain('--with-decryption');
    expect(script).toContain(OPTIONS.parameterName);
    expect(script).toContain('--region "us-east-1"');
  });

  it('refuses to continue when the token is still the placeholder', () => {
    expect(script).toContain(SSM_PLACEHOLDER_VALUE);
    expect(script).toContain('exit 1');
  });

  it('registers unattended and replaces a stale registration', () => {
    expect(script).toContain('--unattended');
    expect(script).toContain('--replace');
    expect(script).toContain('--url "https://github.com/m-howard/night-shift"');
    expect(script).toContain('--name "night-shift-dev-runner"');
    expect(script).toContain('--runnergroup "Default"');
  });

  it('passes the labels comma-joined', () => {
    expect(script).toContain('--labels "self-hosted,linux,x64,night-shift"');
  });

  it('installs the runner as a service so it survives a reboot', () => {
    expect(script).toContain('svc.sh install');
    expect(script).toContain('svc.sh start');
  });

  it('never embeds a literal token, only the shell variable', () => {
    expect(script).toContain('--token "${TOKEN}"');
    expect(script).not.toMatch(/--token "[A-Z0-9]{20,}"/);
  });

  it('matches its approved form', () => {
    expect(script).toMatchSnapshot();
  });
});
