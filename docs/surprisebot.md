---
summary: "Surprisebot is a high-autonomy, multi-agent Surprisebot deployment with durable memory and a dedicated control workspace."
read_when:
  - You want a complete overview of Surprisebot architecture and behavior
---
# Surprisebot

Surprisebot is a Surprisebot deployment tuned for high‑autonomy, multi‑agent operation with durable memory. It is designed to run continuously on a gateway host and deliver results through the channels you already use.

## What Surprisebot is

- A **single control plane** (Surprisebot Gateway) that runs 24/7.
- A **multi‑agent team** with clearly separated roles and responsibilities.
- A **durable memory system** that survives sessions and tracks preference drift and decision history.
- **Tool‑driven execution** that can act on the host when elevated access is explicitly enabled.

## System map

1. **Channels** → inbound messages (Telegram, WhatsApp, Slack, Discord, etc.).
2. **Gateway** → routing, auth, tools, sessions, queue, and policies.
3. **Agents** → isolated workspaces, per‑agent models, tool scopes.
4. **Memory** → MEMORY.md + memory/*.md for profile, preferences, decisions, active goals, and daily logs.
5. **Outputs** → replies, artifacts, and files.

## Autonomy and control

Surprisebot can act with full host privileges only when you explicitly enable elevated tools and allow the specific actions it can run.

- Use **tool policy** to define what it can do.
- Use **elevated** mode only when you intentionally want host‑level changes.
- Keep a **clear allowlist** for commands, file paths, and tools.

See: [Gateway Configuration](/gateway/configuration) and [Elevated Tools](/tools/elevated).

## Memory design (durable + drift‑aware)

Surprisebot uses a layered memory system that is both durable and structured:

- `MEMORY.md` — anchor file for memory search.
- `memory/profile.md` — stable identity, constraints, current preferences.
- `memory/preferences.md` — preference history (with drift over time).
- `memory/decisions.md` — decisions with ids and rationale.
- `memory/active.md` — current goals and next steps.
- `memory/YYYY-MM-DD.md` — daily episodic logs.

Memory is indexed for semantic search and continuously refreshed by memory capture turns.

See: [Memory Concepts](/concepts/memory) and [Slash Commands](/tools/slash-commands).

### Memory commands

Surprisebot supports structured memory commands (authorized senders only):

- `/remember <text>`
- `/prefer <text>`
- `/decide <text>`
- `/active <text>`
- `/forget <text>`
- `/deprecate <text>`

These commands update the memory files directly and support preference drift + decision deprecation.

## Surprisebot Core Team (multi‑agent)

Surprisebot is structured as a coordinated team. Each agent has a focus area and a clear deliverable:

1. **Coordinator** — routes tasks, merges outputs, enforces quality.
2. **Recon** — surface mapping and enumeration.
3. **AppSec** — web/API testing and auth analysis.
4. **Client‑Side** — browser and UI security workflows.
5. **Infrastructure** — internal services, metadata, and SSRF paths.
6. **Token/JWT** — session handling, JWT pitfalls, token issuance.
7. **Logic** — business flows, rate limits, abuse paths.
8. **Data** — storage exposures, indexing, misconfigurations.
9. **Report** — writeups, repro clarity, impact articulation.
10. **Ops** — environment checks, uptime, background jobs.
11. **Memory** — captures decisions, preference drift, and summaries.
12. **QA** — verifies claims and validates fixes.

## Recon pipeline (continuous)

Surprisebot runs a repeatable recon cadence on in‑scope targets. It keeps daily
inventory diffs, JS discoveries, cloud exposure checks, and takeover hygiene.

Recommended layout (example):

- `~/surprisebot/surprisebot/recon/targets.txt` — one program/target per line
- `~/surprisebot/surprisebot/recon/pipeline.md` — stages + skills
- `~/surprisebot/surprisebot/recon/outputs/` — per‑target inventory
- `~/surprisebot/surprisebot/recon/runs/` — daily + weekly summaries

## Research mesh (24/7)

Surprisebot can run parallel research streams on a schedule:

- Exposure monitoring (public disclosures, leaks, writeups)
- CVE + vuln announcements
- Top hunter intel (methodology shifts, new tools)
- Dork monitoring (public search only)
- AI/tech trends
- Program changes + scope updates

Research outputs are summarized into daily/weekly digests and queued for recon.

## Skill sync

If you run multiple gateways or machines, sync skill bundles on a schedule so
every agent shares the same playbooks.

## Artifacts and outputs

Surprisebot prefers **explicit artifacts** for complex work:

- Written reports and checklists in workspace files.
- Structured JSON summaries for automation hand‑off.
- Short, actionable messages on chat surfaces.

## Channels and UI

Surprisebot can be driven from any supported channel, and monitored through the Control UI.

See: [Channels](/channels) and [Control UI](/web/control-ui).

## Skills and extensions

Surprisebot can load curated skills from a workspace‑local `skills/` folder (separate from system skills). This allows specialization without changing core code.

See: [Skills](/tools/skills).

## Operating principles

- **Safety first**: least privilege by default.
- **Traceability**: decisions and preferences are recorded.
- **Deterministic output**: short replies, detailed artifacts.
- **Memory‑aware**: always search memory before asserting past decisions.

## Summary

Surprisebot is a high‑autonomy Surprisebot deployment that combines multi‑agent coordination, durable memory, and tool‑driven execution. It is designed to operate continuously, with explicit control over scope, safety, and change management.
