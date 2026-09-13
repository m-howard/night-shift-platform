<h1 align="center">Night Shift - Platform</h1>

<p align="center">
  <em>The self-hosted GitHub Actions infrastructure.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-6.0-blue?style=flat-square&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Bun-1.3-black?style=flat-square&logo=bun" alt="Bun">
  <img src="https://img.shields.io/badge/Node-24-339933?style=flat-square&logo=nodedotjs" alt="Node">
  <img src="https://img.shields.io/badge/Pulumi-3.256-purple?style=flat-square&logo=pulumi" alt="Pulumi">
  <img src="https://img.shields.io/badge/AWS-orange?style=flat-square&logo=amazon-aws" alt="AWS">
  <img src="https://img.shields.io/badge/Vitest-4.1-6E9F18?style=flat-square&logo=vitest" alt="Vitest">
  <img src="https://img.shields.io/badge/ESLint-10-4B32C3?style=flat-square&logo=eslint" alt="ESLint">
</p>

## ✨ What this is

[TBD]

## 🚀 Quick start

The repository ships a dev container with Node, Bun, the Pulumi CLI, the AWS CLI and `gh` already
pinned to the versions this repo declares. Open it in VS Code and reopen in container, then:

```bash
bun install         # post-create already runs this
bun run test        # unit suite — no credentials, no network
bun run lint
bun run typecheck
```

For infrastructure work, state lives in the local file backend:

```bash
cp .env.example .env    # set AWS_REGION and PULUMI_CONFIG_PASSPHRASE
pulumi login --local
```

## 🏗️ Architecture

> **Status:** the bootstrap stack is written — one runner, not yet a fleet.

The Pulumi stack under `src/` describes the self-hosted Actions EKS runner infrastructure on AWS. It deploys into a VPC that already exists; this stack never creates one.

Shell access is AWS Systems Manager Session Manager only — there is no SSH, no key pair and no
inbound rule. Pure logic (naming, tagging, config validation, IAM documents, the boot script) lives
in `src/lib/` and `src/config/`, separately from the components, because it is the part a unit test
can reach without an engine or credentials.

### Deploying

```bash
pulumi stack select dev
pulumi config set nightshift:vpcId vpc-…          # an existing VPC
pulumi config set --path nightshift:subnetIds[0] subnet-…
pulumi preview                                     # attach this to the pull request
pulumi up
```

The configured subnets **must have a route to a NAT gateway**. The runner is launched without a
public IP and must reach github.com outbound; in a subnet with no egress it boots, looks healthy in
the console, and silently never appears in the repository's runner list.

Every configuration key, its default and what happens when it is absent are documented in
[`.env.example`](.env.example) and `Pulumi.dev.yaml`. A missing or malformed value fails
`pulumi preview` naming the key, rather than deploying something nobody chose.

### Finishing the bootstrap

The stack creates the registration-token parameter holding a placeholder and then deliberately stops
watching its value, so a real token can be placed by hand without being reverted on the next deploy.
After the first `pulumi up`:

1. Generate a registration token under **Settings → Actions → Runners → New self-hosted runner** in
   the repository.
2. Put it in the parameter named by the `registrationParameterName` stack output:

   ```bash
   aws ssm put-parameter --name "$(pulumi stack output registrationParameterName)" \
     --type SecureString --overwrite --value "<token>"
   ```

3. Reboot the instance so cloud-init runs again.

**Registration tokens expire one hour after they are generated.** Steps 2 and 3 have to happen
inside that window; if the runner does not appear, generate a fresh token and repeat rather than
debugging the instance. Because the stack ignores this value by design, Pulumi will never report
that the token has expired.

If `pulumi up` fails with `EntityAlreadyExists` on the OIDC provider, the account already has one —
an account may hold only one per issuer URL. Set `nightshift:createOidcProvider` to `false` and put
the existing provider's ARN in `nightshift:existingOidcProviderArn`.

## 📁 Project structure

```text
.devcontainer/       # Pinned toolchain — versions are read from .nvmrc, .bun-version, package.json
.github/workflows/   # GitHub Actions pipelines
docs/adr/            # Architecture decision records
src/                 # The Pulumi stack — AWS runner infrastructure
├── components/      # Reusable Pulumi components, one per file
├── config/          # Configuration schema, validation and loading
└── lib/             # Pure logic: naming, tagging, IAM documents, the boot script
tests/
├── unit/            # No credentials, no network — the default `bun run test`
├── integration/     # Runs against live AWS; fails loudly when unconfigured
└── helpers/         # Test helpers
scripts/             # Repository tooling
```

## 💻 Scripts

| Command                    | What it does                                               |
| -------------------------- | ---------------------------------------------------------- |
| `bun run test`             | Unit suite. Safe to run anywhere.                          |
| `bun run test:watch`       | Unit suite in watch mode.                                  |
| `bun run test:coverage`    | Unit suite with V8 coverage.                               |
| `bun run test:integration` | Live-AWS suite. Requires real credentials — see below.     |
| `bun run typecheck`        | `tsc --noEmit` over `src`, `tests` and `scripts`.          |
| `bun run lint`             | ESLint, type-aware.                                        |
| `bun run lint:md`          | markdownlint.                                              |
| `bun run format`           | Prettier, writing in place.                                |
| `bun run clean`            | Removes build output; `--all` also removes `node_modules`. |
| `bun run preview`          | `pulumi preview` — the output a pull request must carry.   |
| `bun run deploy`           | `pulumi up`.                                               |
| `bun run refresh`          | Reconciles state with what is actually in the account.     |
| `bun run destroy`          | Tears the stack down.                                      |

### Testing against live infrastructure

`bun run test:integration` talks to a real AWS account and is deliberately **not** part of
`bun run test`. Missing configuration fails the run and names the variable rather than skipping —
a suite that reports green having tested nothing is the one failure mode an auto-deploy pipeline
cannot afford.

## 📖 Conventions

[AGENTS.md](AGENTS.md) records the conventions this repository enforces, for humans and agents
alike. `eslint.config.mjs` encodes most of them; the ones a linter cannot check live in that file.

## 📄 License

MIT

---

<p align="center">
  <em>Good night. The shift starts at midnight. 🌙</em>
</p>
