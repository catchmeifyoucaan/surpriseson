---
summary: "Bundled profile templates (agent rosters)"
read_when:
  - You want to preseed a multi-agent roster during init
  - You want to ship a custom profile for your team
---

# Profiles (templates)

Surprisebot ships optional **profile templates** you can apply during init to preseed an agent roster.

## Apply a profile

```bash
surprisebot init --profile-template bug-hunter
```

## What it does
- Loads `profiles/<name>/agents.json5` from the Surprisebot package.
- Merges it into config **only for missing fields** (does not overwrite existing `agents.list`).
- Leaves channels/auth untouched.

## Bundled profiles
- `bug-hunter`: multi-agent roster tuned for recon + vuln triage.

## Build your own profile
Create a folder with an `agents.json5` file and ship it in your fork:

```
profiles/
  my-team/
    agents.json5
```

Then run:

```bash
surprisebot init --profile-template my-team
```
