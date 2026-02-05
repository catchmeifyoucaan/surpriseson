# Surprisesons

Surprisesons is a multi‑agent, always‑on research + recon stack built on Clawdbot.
It runs coordinated agents for deep recon, continuous research, and reporting, with
model routing and long‑term memory capture.

## What it does
- Multi‑agent bug‑hunter team with specialized roles (recon, web, API, auth, SSRF, cloud, client, mobile, chaining, AI/LLM, reporting).
- Mega‑research team that runs continuous public‑source monitoring (exposure, CVE, hunter intel, **super dorking**, trends, people, program intel).
- Deep recon pipeline with daily diffs, takeover checks, and change monitoring.
- Memory capture + retrieval for long‑term context.
- Model routing across Codex, Gemini, Claude, and Perplexity.

## Layout
- recon/            Recon pipeline, outputs, run logs
- research/         Research pipelines, sources, watchlists, outputs
- docs/             Full documentation
- skills/           Symlink to Surprisesons skill catalog
- EXPORT.md         Migration + backup guide

## Quick start
1) Targets: edit `recon/targets.txt`.
2) Run recon: `sudo /root/surprisebot/recon/run.sh`.
3) Review outputs in `recon/outputs/` and `recon/runs/`.
4) Research outputs live in `research/outputs/` and `research/runs/`.

## Agent roster (summary)
Bug hunters
- bug-lead, bug-recon, bug-web, bug-api, bug-auth, bug-ssrf, bug-cloud,
  bug-client, bug-mobile, bug-chain, bug-ai, bug-report

Research team
- research-lead (coordination + synthesis)
- research-leaks, research-hunters, research-cve, research-dorks,
  research-trends, research-people, research-programs

See `docs/agents.md` for full details.

## Models and routing (summary)
- Default: Codex GPT‑5.2 (deep coding / exploit reasoning)
- Research primary: Perplexity Sonar / Sonar Pro
- Fallbacks: Claude Sonnet 4.5, Gemini 3 Flash / 2.5 Flash

See `docs/models.md` for the full model map.

## Memory
Long‑term memory capture is enabled with frequent sync + retrieval.
See `docs/memory.md` for policy and commands.

## Docs
- docs/overview.md
- docs/agents.md
- docs/models.md
- docs/memory.md
- docs/recon.md
- docs/research.md
- docs/ops.md
- docs/export.md

## Safety
Only run recon/research against in‑scope assets and public sources.
