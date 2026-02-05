---
summary: "SurprisebotHub guide: public skills registry + CLI workflows"
read_when:
  - Introducing SurprisebotHub to new users
  - Installing, searching, or publishing skills
  - Explaining SurprisebotHub CLI flags and sync behavior
---

# SurprisebotHub

SurprisebotHub is the **public skill registry for Surprisebot**. It is a free service: all skills are public, open, and visible to everyone for sharing and reuse. A skill is just a folder with a `SKILL.md` file (plus supporting text files). You can browse skills in the web app or use the CLI to search, install, update, and publish skills.

Site: [surprisebothub.com](https://surprisebothub.com)

## Who this is for (beginner-friendly)

If you want to add new capabilities to your Surprisebot agent, SurprisebotHub is the easiest way to find and install skills. You do not need to know how the backend works. You can:

- Search for skills by plain language.
- Install a skill into your workspace.
- Update skills later with one command.
- Back up your own skills by publishing them.

## Quick start (non-technical)

1) Install the CLI (see next section).
2) Search for something you need:
   - `surprisebothub search "calendar"`
3) Install a skill:
   - `surprisebothub install <skill-slug>`
4) Start a new Surprisebot session so it picks up the new skill.

## Install the CLI

Pick one:

```bash
npm i -g surprisebothub
```

```bash
pnpm add -g surprisebothub
```

## How it fits into Surprisebot

By default, the CLI installs skills into `./skills` under your current working directory. If a Surprisebot workspace is configured, `surprisebothub` falls back to that workspace unless you override `--workdir` (or `SURPRISEBOTHUB_WORKDIR`). Surprisebot loads workspace skills from `<workspace>/skills` and will pick them up in the **next** session. If you already use `~/.surprisebot/skills` or bundled skills, workspace skills take precedence.

For more detail on how skills are loaded, shared, and gated, see
[Skills](/tools/skills).

## What the service provides (features)

- **Public browsing** of skills and their `SKILL.md` content.
- **Search** powered by embeddings (vector search), not just keywords.
- **Versioning** with semver, changelogs, and tags (including `latest`).
- **Downloads** as a zip per version.
- **Stars and comments** for community feedback.
- **Moderation** hooks for approvals and audits.
- **CLI-friendly API** for automation and scripting.

## CLI commands and parameters

Global options (apply to all commands):

- `--workdir <dir>`: Working directory (default: current dir; falls back to Surprisebot workspace).
- `--dir <dir>`: Skills directory, relative to workdir (default: `skills`).
- `--site <url>`: Site base URL (browser login).
- `--registry <url>`: Registry API base URL.
- `--no-input`: Disable prompts (non-interactive).
- `-V, --cli-version`: Print CLI version.

Auth:

- `surprisebothub login` (browser flow) or `surprisebothub login --token <token>`
- `surprisebothub logout`
- `surprisebothub whoami`

Options:

- `--token <token>`: Paste an API token.
- `--label <label>`: Label stored for browser login tokens (default: `CLI token`).
- `--no-browser`: Do not open a browser (requires `--token`).

Search:

- `surprisebothub search "query"`
- `--limit <n>`: Max results.

Install:

- `surprisebothub install <slug>`
- `--version <version>`: Install a specific version.
- `--force`: Overwrite if the folder already exists.

Update:

- `surprisebothub update <slug>`
- `surprisebothub update --all`
- `--version <version>`: Update to a specific version (single slug only).
- `--force`: Overwrite when local files do not match any published version.

List:

- `surprisebothub list` (reads `.surprisebothub/lock.json`)

Publish:

- `surprisebothub publish <path>`
- `--slug <slug>`: Skill slug.
- `--name <name>`: Display name.
- `--version <version>`: Semver version.
- `--changelog <text>`: Changelog text (can be empty).
- `--tags <tags>`: Comma-separated tags (default: `latest`).

Delete/undelete (owner/admin only):

- `surprisebothub delete <slug> --yes`
- `surprisebothub undelete <slug> --yes`

Sync (scan local skills + publish new/updated):

- `surprisebothub sync`
- `--root <dir...>`: Extra scan roots.
- `--all`: Upload everything without prompts.
- `--dry-run`: Show what would be uploaded.
- `--bump <type>`: `patch|minor|major` for updates (default: `patch`).
- `--changelog <text>`: Changelog for non-interactive updates.
- `--tags <tags>`: Comma-separated tags (default: `latest`).
- `--concurrency <n>`: Registry checks (default: 4).

## Common workflows for agents

### Search for skills

```bash
surprisebothub search "postgres backups"
```

### Download new skills

```bash
surprisebothub install my-skill-pack
```

### Update installed skills

```bash
surprisebothub update --all
```

### Back up your skills (publish or sync)

For a single skill folder:

```bash
surprisebothub publish ./my-skill --slug my-skill --name "My Skill" --version 1.0.0 --tags latest
```

To scan and back up many skills at once:

```bash
surprisebothub sync --all
```

## Advanced details (technical)

### Versioning and tags

- Each publish creates a new **semver** `SkillVersion`.
- Tags (like `latest`) point to a version; moving tags lets you roll back.
- Changelogs are attached per version and can be empty when syncing or publishing updates.

### Local changes vs registry versions

Updates compare the local skill contents to registry versions using a content hash. If local files do not match any published version, the CLI asks before overwriting (or requires `--force` in non-interactive runs).

### Sync scanning and fallback roots

`surprisebothub sync` scans your current workdir first. If no skills are found, it falls back to known legacy locations (for example `~/surprisebot/skills` and `~/.surprisebot/skills`). This is designed to find older skill installs without extra flags.

### Storage and lockfile

- Installed skills are recorded in `.surprisebothub/lock.json` under your workdir.
- Auth tokens are stored in the SurprisebotHub CLI config file (override via `SURPRISEBOTHUB_CONFIG_PATH`).

### Telemetry (install counts)

When you run `surprisebothub sync` while logged in, the CLI sends a minimal snapshot to compute install counts. You can disable this entirely:

```bash
export SURPRISEBOTHUB_DISABLE_TELEMETRY=1
```

## Environment variables

- `SURPRISEBOTHUB_SITE`: Override the site URL.
- `SURPRISEBOTHUB_REGISTRY`: Override the registry API URL.
- `SURPRISEBOTHUB_CONFIG_PATH`: Override where the CLI stores the token/config.
- `SURPRISEBOTHUB_WORKDIR`: Override the default workdir.
- `SURPRISEBOTHUB_DISABLE_TELEMETRY=1`: Disable telemetry on `sync`.
