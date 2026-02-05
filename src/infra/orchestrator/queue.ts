import fs from "node:fs";

import type { IncidentRecord } from "../incidents.js";

export type IncidentBatch = {
  incidents: IncidentRecord[];
  nextOffset: number;
  mtimeMs?: number;
};

export async function readIncidentBatch(params: {
  incidentsPath: string;
  offset?: number;
}): Promise<IncidentBatch> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(params.incidentsPath);
  } catch {
    return { incidents: [], nextOffset: params.offset ?? 0 };
  }

  let offset = params.offset ?? 0;
  if (offset < 0) offset = 0;
  if (stat.size < offset) offset = 0;
  if (stat.size === offset) {
    return { incidents: [], nextOffset: offset, mtimeMs: stat.mtimeMs };
  }

  const length = stat.size - offset;
  const handle = await fs.promises.open(params.incidentsPath, "r");
  const buffer = Buffer.alloc(length);
  await handle.read(buffer, 0, length, offset);
  await handle.close();

  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const incidents: IncidentRecord[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as IncidentRecord;
      if (parsed && typeof parsed === "object") incidents.push(parsed);
    } catch {
      // skip malformed lines
    }
  }
  return { incidents, nextOffset: stat.size, mtimeMs: stat.mtimeMs };
}
