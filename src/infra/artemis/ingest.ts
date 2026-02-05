import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export type ArtemisIngestOptions = {
  inputPath: string;
  outputDir: string;
  outputFile?: string;
  source?: string;
  runId?: string;
};

export type ArtemisIngestResult = {
  ok: boolean;
  inputFiles: string[];
  outputFile: string;
  ingested: number;
};

function normalizeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes(".") && !trimmed.includes(" ")) return `https://${trimmed}`;
  return undefined;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function extractItems(value: unknown): Array<Record<string, unknown>> {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((entry) => entry && typeof entry === "object") as Array<Record<string, unknown>>;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const listKeys = ["items", "findings", "exposures", "results", "leads", "entries"];
    for (const key of listKeys) {
      const candidate = obj[key];
      if (Array.isArray(candidate)) {
        return candidate.filter((entry) => entry && typeof entry === "object") as Array<Record<string, unknown>>;
      }
    }
    return [obj];
  }
  return [];
}

function mapRecord(
  record: Record<string, unknown>,
  source: string,
  runId?: string,
): Record<string, unknown> {
  const urlCandidate =
    record.url ?? record.link ?? record.asset ?? record.domain ?? record.host ?? record.hostname;
  const url = normalizeUrl(urlCandidate);
  const title =
    normalizeString(record.title ?? record.name ?? record.summary ?? record.description) ??
    url ??
    "Research item";
  const summary = normalizeString(record.summary ?? record.description ?? record.snippet);
  const severity = normalizeString(record.severity ?? record.priority ?? record.risk ?? record.impact);
  const tags = normalizeStringArray(record.tags ?? record.labels);

  return {
    id: record.id ?? `artemis-ingest-${crypto.randomUUID()}`,
    kind: record.kind ?? record.type ?? (tags.some((tag) => /exposure/i.test(tag)) ? "exposure" : "research"),
    title,
    summary,
    url,
    severity,
    tags,
    source: record.source ?? source,
    runId: record.runId ?? record.run_id ?? runId,
    timestamp: new Date().toISOString(),
  };
}

async function listInputFiles(inputPath: string): Promise<string[]> {
  const stat = await fs.stat(inputPath);
  if (stat.isFile()) return [inputPath];
  const entries = await fs.readdir(inputPath);
  return entries
    .filter((entry) => entry.endsWith(".json") || entry.endsWith(".jsonl") || entry.endsWith(".ndjson"))
    .map((entry) => path.join(inputPath, entry));
}

export async function ingestArtemisOutputs(options: ArtemisIngestOptions): Promise<ArtemisIngestResult> {
  const inputFiles = await listInputFiles(options.inputPath);
  await fs.mkdir(options.outputDir, { recursive: true });
  const outputFile = options.outputFile ??
    path.join(options.outputDir, `artemis-ingest-${new Date().toISOString().slice(0, 10)}.jsonl`);

  let ingested = 0;
  for (const filePath of inputFiles) {
    const ext = path.extname(filePath).toLowerCase();
    const raw = await fs.readFile(filePath, "utf8");
    let items: Array<Record<string, unknown>> = [];

    if (ext === ".jsonl" || ext === ".ndjson") {
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          items.push(...extractItems(parsed));
        } catch {
          continue;
        }
      }
    } else if (ext === ".json") {
      try {
        const parsed = JSON.parse(raw);
        items = extractItems(parsed);
      } catch {
        continue;
      }
    }

    if (items.length === 0) continue;

    const mapped = items.map((item) => mapRecord(item, options.source ?? "artemis-cert", options.runId));
    const lines = mapped.map((item) => JSON.stringify(item)).join("\n") + "\n";
    await fs.appendFile(outputFile, lines);
    ingested += mapped.length;
  }

  return {
    ok: true,
    inputFiles,
    outputFile,
    ingested,
  };
}
