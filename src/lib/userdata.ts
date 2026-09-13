/**
 * Cloud-init user data for the runner instance.
 *
 * Pure string generation — no filesystem, no network, no Pulumi types — so the whole script is
 * assertable from a unit test. It is passed to the instance as plain text rather than base64:
 * base64 would only obscure it in `pulumi preview` diffs, and that diff is the human review gate.
 *
 * ## Shell safety
 *
 * `repository`, `runnerGroup` and every label are interpolated into double-quoted shell contexts
 * below. Nothing here escapes them; safety comes entirely from `src/config/validate.ts`, which
 * restricts all three to `[\w.-]` before they ever reach this function. Loosening those patterns
 * opens a shell-injection path into root-privileged user data — change them together or not at all.
 */

import { RUNNER_SHA256, RUNNER_VERSION, SSM_PLACEHOLDER_VALUE } from './constants.ts';

/** How the runner registers itself with GitHub. */
export interface RunnerRegistrationOptions {
  /** Name the runner appears under in the repository's runner list. */
  readonly name: string;
  /** Runner group to join. */
  readonly group: string;
  /** Labels used by `runs-on`. */
  readonly labels: readonly string[];
  /** AWS region, for the SSM call that fetches the registration token. */
  readonly region: string;
}

/** Arguments for {@link buildUserData}. */
export interface UserDataOptions {
  /** Repository the runner registers against, as `owner/repo`. */
  readonly repository: string;
  /** Name of the SSM parameter holding the registration token. */
  readonly parameterName: string;
  /** Registration details. Grouped to keep this interface at three fields. */
  readonly runner: RunnerRegistrationOptions;
}

/** Unprivileged account the runner runs as. The runner refuses to configure itself as root. */
const RUNNER_USER = 'runner';

/** Where the runner is installed. */
const RUNNER_HOME = '/opt/actions-runner';

/** Seconds any single download may take before curl gives up. */
const CURL_MAX_SECONDS = 120;

/**
 * Builds the boot script for a runner instance.
 *
 * The script is fail-fast throughout (`set -euo pipefail`, bounded curl timeouts) because the
 * alternative failure mode is far worse than a crash: an instance in a subnet with no NAT route
 * hangs, boots to a healthy-looking state, registers nothing, and reports no error anywhere a
 * console user would look.
 *
 * @param options Repository, parameter name and registration details.
 * @returns A bash script suitable for the EC2 `userData` field.
 *
 * @example
 * ```ts
 * const script = buildUserData({
 *   repository: 'm-howard/night-shift',
 *   parameterName: '/night-shift/dev/runner-registration-token',
 *   runner: { name: 'night-shift-dev', group: 'Default', labels: ['self-hosted'], region: 'us-east-1' },
 * });
 * ```
 */
export function buildUserData(options: UserDataOptions): string {
  const { repository, parameterName, runner } = options;
  const tarball = `actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz`;
  const downloadUrl = `https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${tarball}`;

  return `#!/usr/bin/env bash
# Managed by Pulumi (src/lib/userdata.ts). Edits here are overwritten on the next deploy.
set -euo pipefail

log() { echo "[night-shift] $*" | systemd-cat -t night-shift-bootstrap || echo "[night-shift] $*"; }

# The runner is a .NET application: without libicu it installs cleanly and then fails to start,
# which is the most common silent failure on Amazon Linux 2023. tar is not in the minimal AMI.
log "installing prerequisites"
dnf install -y libicu tar

log "creating the ${RUNNER_USER} service account"
id -u ${RUNNER_USER} >/dev/null 2>&1 || useradd --create-home --shell /bin/bash ${RUNNER_USER}
install -d -o ${RUNNER_USER} -g ${RUNNER_USER} ${RUNNER_HOME}

log "downloading actions runner ${RUNNER_VERSION}"
cd ${RUNNER_HOME}
curl -fsSL --max-time ${String(CURL_MAX_SECONDS)} -o "${tarball}" "${downloadUrl}"

# Verify before extracting: the tarball is unpacked and its scripts run with root's privileges, so
# an unverified download is arbitrary code execution with a network in the middle.
log "verifying checksum"
echo "${RUNNER_SHA256}  ${tarball}" | sha256sum --check --status
tar -xzf "${tarball}" --owner=${RUNNER_USER}
rm -f "${tarball}"
chown -R ${RUNNER_USER}:${RUNNER_USER} ${RUNNER_HOME}

# Fetched at boot via the instance role — no credentials are baked into user data, which is
# readable by anything that can reach the metadata service.
log "reading the registration token from SSM"
TOKEN="$(aws ssm get-parameter \\
  --name "${parameterName}" \\
  --with-decryption \\
  --region "${runner.region}" \\
  --query Parameter.Value \\
  --output text)"

# Fail loudly rather than registering nothing. A runner that never appears in the repository's
# runner list is otherwise indistinguishable from one that is merely slow to boot.
if [ "\${TOKEN}" = "${SSM_PLACEHOLDER_VALUE}" ]; then
  log "registration token is still the placeholder — put a real token in ${parameterName} and reboot"
  exit 1
fi

# --unattended because there is no TTY; --replace so replacing this instance supersedes the stale
# registration of the same name instead of colliding with it.
log "registering with https://github.com/${repository}"
sudo -u ${RUNNER_USER} ${RUNNER_HOME}/config.sh \\
  --unattended \\
  --replace \\
  --url "https://github.com/${repository}" \\
  --token "\${TOKEN}" \\
  --name "${runner.name}" \\
  --runnergroup "${runner.group}" \\
  --labels "${runner.labels.join(',')}" \\
  --work _work

log "installing the runner service"
${RUNNER_HOME}/svc.sh install ${RUNNER_USER}
${RUNNER_HOME}/svc.sh start

log "bootstrap complete"
`;
}
