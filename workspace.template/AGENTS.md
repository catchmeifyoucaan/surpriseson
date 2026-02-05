# AGENTS.md - Surprisesons Workspace

This folder is the assistant's working directory.

## First run (one-time)
- If BOOTSTRAP.md exists, follow its ritual and delete it once complete.
- Your agent identity lives in IDENTITY.md.
- Your profile lives in USER.md.

## Backup tip (recommended)
If you treat this workspace as the agent's "memory", make it a git repo (ideally private) so identity
and notes are backed up.

```bash
git init
git add AGENTS.md
git commit -m "Add agent workspace"
```

## Safety defaults
- Don't exfiltrate secrets or private data.
- Don't run destructive commands unless explicitly asked.
- Be concise in chat; write longer output to files in this workspace.
- When any agent discovers a high-value finding (leak, exposure, vuln signal, auth issue, policy change, CVE/POC, or notable intel), send an immediate alert to the user that includes: what, where, how found, why it matters, and next action. If unsure, still alert and label as "unverified".

## Directory Map
- recon/        -> recon pipelines, targets, diffs, outputs
- research/     -> intel, CVEs, OSINT, methodology notes
- reports/      -> formal findings and writeups
- memory/       -> memory logs, decisions, preferences
- docs/         -> playbooks, standards, SOPs

## Daily Routine
- Morning: run recon sweep + CVE scan + OSINT pulse
- Midday: validate top 10 leads
- Evening: write reports + update playbooks

## Output Standards
- For recon/research/reporting tasks, use:
  - Summary (3-7 bullets)
  - Evidence (links/logs/screens)
  - Next steps (clear actions)
- For direct messages from the Boss (e.g., "hey", "who are you?"), reply normally and succinctly in the same channel. Do not wrap with Summary/Evidence/Next steps and do not ask the Boss to route messages unless a required tool is truly unavailable.

## Active Tracking
- Update memory/active.md with:
  - Current goals
  - Running jobs
  - Blockers

## Memory Discipline
- /remember -> durable facts
- /prefer -> preferences
- /decide -> decisions + rationale
- /active -> current tasks

## Daily memory (recommended)
- Keep a short daily log at memory/YYYY-MM-DD.md (create memory/ if needed).
- On session start, read today + yesterday if present.
- Capture durable facts, preferences, and decisions; avoid secrets.

## Shared memory (teamwide)
- Read memory/shared.md for durable cross-agent context.
- Subagents: propose updates in memory/shared.pending.md (do not edit shared.md).
- Core: mark approved lines with [APPROVED] and run /shared-review to merge.

## Subagents & Roles
- Recon Specialist -> asset discovery and diffing
- CVE Monitor -> feeds and exploit tracking
- Dorking Research -> search engine sweeps + file exposures
- OSINT -> public intel + community signals
- Reporting -> writeups and summaries

## Orchestrator Brain (surprisebot-core)
- Own the global loop: ingest -> triage -> plan -> dispatch -> monitor -> verify -> synthesize -> learn.
- Use memory/incidents.jsonl as the single queue for new issues, tasks, and follow-ups.
- Route execution to specialist agents via sessions_spawn; keep surprisebot-core focused on strategy and verification.
- Promote durable memory only through memory/shared.pending.md and /shared-review.
- Keep the protocol and formats in docs/orchestrator.md and memory/incidents.README.md authoritative.

## Alerts (Critical Channel)
- Alerts are auto-routed by the gateway to Telegram `-1003238795231` (no manual message tool needed).
- Alerts include: heartbeats, recon/research summaries, errors, self-heal actions, and notable intel.
- Use the minimum format: Summary -> Evidence -> Next action.
- If there is any material update, do NOT include HEARTBEAT_OK.

## Heartbeats
- HEARTBEAT.md can hold a tiny checklist for heartbeat runs; keep it small.
- Only return HEARTBEAT_OK during explicit heartbeat runs; never use it for normal user messages or commands.
- Treat a heartbeat as only the explicit heartbeat prompt or a system-flagged heartbeat run; never classify greetings (hi/hey/ok) as heartbeat polls.
- During a heartbeat, send a short status summary (2-5 bullets). If truly idle, append HEARTBEAT_OK after the status line.
