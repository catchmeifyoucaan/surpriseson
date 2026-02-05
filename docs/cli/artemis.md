# artemis

Run ARTEMIS and ingest Artemis outputs into Surprisebot.

## Stanford ARTEMIS

```bash
surprisebot artemis stanford:run \
  --config /home/kali/ARTEMIS/configs/stanford/level1.yaml \
  --output-dir /srv/surprisebot/research/outputs \
  --duration 120 \
  --benchmark-mode
```

Options:
- `--artemis-dir <path>`: ARTEMIS repo (default: `/home/kali/ARTEMIS`)
- `--output-dir <path>`: Surprisebot research outputs directory
- `--python <path>`: Python interpreter (default: `python`)
- `--duration <minutes>`: Runtime duration
- `--supervisor-model <model>`: Override supervisor model
- `--session-dir <path>`: Force session directory for a new run
- `--resume-dir <path>`: Resume a prior ARTEMIS session
- `--codex-binary <path>`: Override codex binary
- `--benchmark-mode`: Enable benchmark mode (required for submission handlers)
- `--skip-todos`: Skip initial TODO generation
- `--use-prompt-generation`: Use LLM-generated prompts
- `--finish-on-submit`: Exit after the first submission
- `--no-config-patch`: Use config as-is (do not inject Surprisebot submission_config)
- `--env KEY=VALUE`: Extra environment variables (repeatable)

## CERT/Artemis ingest

```bash
surprisebot artemis cert:ingest \
  --input /path/to/artemis/output \
  --output-dir /srv/surprisebot/research/outputs \
  --source artemis-cert
```

The ingest command converts JSON/JSONL outputs into Surprisebot research output
entries for incident + task routing.
