import fs from "node:fs/promises";
import path from "node:path";

import type { Driver, Session } from "neo4j-driver";
import neo4j from "neo4j-driver";
import chokidar, { type FSWatcher } from "chokidar";

import type { SurprisebotConfig } from "../config/config.js";
import { resolveMemoryGraphConfig, type ResolvedMemoryGraphConfig } from "../agents/memory-graph.js";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { buildFileEntry, hashText, listMemoryFiles, normalizeRelPath } from "./internal.js";

export type MemoryGraphNode = {
  id: string;
  kind: string;
  text: string;
  status?: string;
  date?: string;
  sourcePath?: string;
  line?: number;
};

export type MemoryGraphEdge = {
  from: string;
  to: string;
  type: string;
};

export type MemoryGraphQueryResult = {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
};

type MemoryGraphEntry = MemoryGraphNode & {
  supersededBy?: string;
};

type MemoryGraphIndex = {
  entries: MemoryGraphEntry[];
  edges: MemoryGraphEdge[];
};

const GRAPH_CACHE = new Map<string, MemoryGraphManager>();

const PREF_LINE_RE =
  /^-\s+(\d{4}-\d{2}-\d{2})\s+(PREF-\d{8}-\d+)\s+\[([^\]]+)\]:\s*(.+)$/i;
const DEC_LINE_RE = /^-\s+(\d{4}-\d{2}-\d{2})\s+(DEC-\d{8}-\d+):\s*(.+)$/i;
const ACTIVE_LINE_RE = /^-\s+(\d{4}-\d{2}-\d{2}):\s*(.+)$/i;
const DEPRECATED_RE = /\[DEPRECATED\s+(\d{4}-\d{2}-\d{2})(?:;?\s*superseded by\s+([A-Z]+-\d{8}-\d+))?\]/i;
const SUPERSEDED_RE = /superseded by\s+([A-Z]+-\d{8}-\d+)/i;

export class MemoryGraphManager {
  private readonly cacheKey: string;
  private readonly cfg: SurprisebotConfig;
  private readonly agentId: string;
  private readonly workspaceDir: string;
  private readonly settings: ResolvedMemoryGraphConfig;
  private readonly driver: Driver;
  private readonly workspaceId: string;
  private watcher: FSWatcher | null = null;
  private watchTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private dirty = false;
  private sessionWarm = new Set<string>();
  private syncing: Promise<void> | null = null;
  private fileHashes = new Map<string, string>();

  static async get(params: {
    cfg: SurprisebotConfig;
    agentId: string;
  }): Promise<MemoryGraphManager | null> {
    const { cfg, agentId } = params;
    const settings = resolveMemoryGraphConfig(cfg, agentId);
    if (!settings) return null;
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const key = `${agentId}:${workspaceDir}:${JSON.stringify(settings)}`;
    const existing = GRAPH_CACHE.get(key);
    if (existing) return existing;
    const manager = new MemoryGraphManager({
      cacheKey: key,
      cfg,
      agentId,
      workspaceDir,
      settings,
    });
    GRAPH_CACHE.set(key, manager);
    return manager;
  }

  private constructor(params: {
    cacheKey: string;
    cfg: SurprisebotConfig;
    agentId: string;
    workspaceDir: string;
    settings: ResolvedMemoryGraphConfig;
  }) {
    this.cacheKey = params.cacheKey;
    this.cfg = params.cfg;
    this.agentId = params.agentId;
    this.workspaceDir = params.workspaceDir;
    this.settings = params.settings;
    this.workspaceId = `${this.agentId}`;
    this.driver = neo4j.driver(
      this.settings.url,
      neo4j.auth.basic(this.settings.username, this.settings.password),
    );
    void this.ensureSchema();
    this.ensureWatcher();
    this.ensureIntervalSync();
    this.dirty = true;
  }

  async warmSession(sessionKey?: string): Promise<void> {
    if (!this.settings.sync.onSessionStart) return;
    const key = sessionKey?.trim() || "";
    if (key && this.sessionWarm.has(key)) return;
    await this.sync({ reason: "session-start" });
    if (key) this.sessionWarm.add(key);
  }

  async query(params: {
    query: string;
    types?: string[];
    maxResults?: number;
    maxHops?: number;
    sessionKey?: string;
  }): Promise<MemoryGraphQueryResult> {
    await this.warmSession(params.sessionKey);
    if (this.settings.sync.onSearch && this.dirty) {
      await this.sync({ reason: "search" });
    }
    const query = params.query.trim();
    if (!query) return { nodes: [], edges: [] };
    const types = (params.types ?? []).map((value) => value.trim()).filter(Boolean);
    const maxResults = Math.max(
      1,
      Math.floor(params.maxResults ?? this.settings.query.maxResults),
    );
    const maxHops = Math.max(1, Math.floor(params.maxHops ?? this.settings.query.maxHops));

    const session = this.openSession();
    try {
      const matched = await session.run(
        `
        MATCH (e:MemoryEntry {workspaceId: $workspaceId})
        WHERE (toLower(e.text) CONTAINS toLower($query) OR toLower(e.id) CONTAINS toLower($query))
          AND (size($types) = 0 OR e.kind IN $types)
        RETURN e
        LIMIT $limit
        `,
        {
          workspaceId: this.workspaceId,
          query,
          types,
          limit: neo4j.int(maxResults),
        },
      );

      const nodes = new Map<string, MemoryGraphNode>();
      for (const record of matched.records) {
        const node = record.get("e") as neo4j.Node;
        const props = toPlainProps(node.properties);
        const id = String(props.id ?? "");
        if (!id) continue;
        nodes.set(id, {
          id,
          kind: String(props.kind ?? ""),
          text: String(props.text ?? ""),
          status: props.status ? String(props.status) : undefined,
          date: props.date ? String(props.date) : undefined,
          sourcePath: props.sourcePath ? String(props.sourcePath) : undefined,
          line: props.line ? Number(props.line) : undefined,
        });
      }

      const edges: MemoryGraphEdge[] = [];
      if (nodes.size > 0) {
        const ids = Array.from(nodes.keys());
        const relResult = await session.run(
          `
          MATCH path = (a:MemoryEntry {workspaceId: $workspaceId})-[r:RELATES_TO*1..$maxHops]-(b:MemoryEntry {workspaceId: $workspaceId})
          WHERE a.id IN $ids
          RETURN nodes(path) as nodes, relationships(path) as rels
          `,
          {
            workspaceId: this.workspaceId,
            ids,
            maxHops: neo4j.int(maxHops),
          },
        );
        for (const record of relResult.records) {
          const pathNodes = record.get("nodes") as neo4j.Node[];
          const rels = record.get("rels") as neo4j.Relationship[];
          const nodeByIdentity = new Map<number, MemoryGraphNode>();
          for (const node of pathNodes) {
            const props = toPlainProps(node.properties);
            const id = String(props.id ?? "");
            if (!id) continue;
            const mapped: MemoryGraphNode = {
              id,
              kind: String(props.kind ?? ""),
              text: String(props.text ?? ""),
              status: props.status ? String(props.status) : undefined,
              date: props.date ? String(props.date) : undefined,
              sourcePath: props.sourcePath ? String(props.sourcePath) : undefined,
              line: props.line ? Number(props.line) : undefined,
            };
            nodes.set(id, mapped);
            nodeByIdentity.set(toNumber(node.identity), mapped);
          }
          for (const rel of rels) {
            const from = nodeByIdentity.get(toNumber(rel.start))?.id;
            const to = nodeByIdentity.get(toNumber(rel.end))?.id;
            if (!from || !to) continue;
            edges.push({
              from,
              to,
              type: String(rel.properties?.type ?? "related_to"),
            });
          }
        }
      }

      return {
        nodes: Array.from(nodes.values()),
        edges: dedupeEdges(edges),
      };
    } finally {
      await session.close();
    }
  }

  async sync(params?: { reason?: string; force?: boolean }): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.runSync(params).finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  status(): {
    dirty: boolean;
    workspaceDir: string;
    workspaceId: string;
    url: string;
  } {
    return {
      dirty: this.dirty,
      workspaceDir: this.workspaceDir,
      workspaceId: this.workspaceId,
      url: this.settings.url,
    };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.watchTimer) clearTimeout(this.watchTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.watcher) await this.watcher.close();
    await this.driver.close();
    GRAPH_CACHE.delete(this.cacheKey);
  }

  private openSession(): Session {
    return this.driver.session({
      database: this.settings.database || undefined,
    });
  }

  private ensureWatcher() {
    if (!this.settings.sync.watch || this.watcher) return;
    const watchPaths = [
      path.join(this.workspaceDir, "MEMORY.md"),
      path.join(this.workspaceDir, "memory"),
    ];
    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.settings.sync.watchDebounceMs,
        pollInterval: 100,
      },
    });
    const markDirty = () => {
      this.dirty = true;
      this.scheduleWatchSync();
    };
    this.watcher.on("add", markDirty);
    this.watcher.on("change", markDirty);
    this.watcher.on("unlink", markDirty);
  }

  private ensureIntervalSync() {
    const minutes = this.settings.sync.intervalMinutes;
    if (!minutes || minutes <= 0 || this.intervalTimer) return;
    const ms = minutes * 60 * 1000;
    this.intervalTimer = setInterval(() => {
      void this.sync({ reason: "interval" });
    }, ms);
  }

  private scheduleWatchSync() {
    if (!this.settings.sync.watch) return;
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => {
      this.watchTimer = null;
      void this.sync({ reason: "watch" });
    }, this.settings.sync.watchDebounceMs);
  }

  private async ensureSchema() {
    const session = this.openSession();
    try {
      await session.run(
        `CREATE CONSTRAINT workspace_id IF NOT EXISTS FOR (w:Workspace) REQUIRE w.id IS UNIQUE`,
      );
      await session.run(
        `CREATE CONSTRAINT memory_entry_id IF NOT EXISTS FOR (m:MemoryEntry) REQUIRE (m.workspaceId, m.id) IS UNIQUE`,
      );
    } catch {
      // best-effort
    } finally {
      await session.close();
    }
  }

  private async runSync(params?: { reason?: string; force?: boolean }) {
    const entries = await this.buildIndex();
    if (!params?.force && !entries.changed) {
      this.dirty = false;
      return;
    }

    const session = this.openSession();
    try {
      await session.run(
        `
        MERGE (w:Workspace {id: $workspaceId})
        SET w.agentId = $agentId,
            w.updatedAt = $now
        `,
        {
          workspaceId: this.workspaceId,
          agentId: this.agentId,
          now: new Date().toISOString(),
        },
      );
      if (entries.index.entries.length > 0) {
        await session.run(
          `
          UNWIND $entries AS entry
          MERGE (m:MemoryEntry {workspaceId: $workspaceId, id: entry.id})
          SET m.kind = entry.kind,
              m.text = entry.text,
              m.status = entry.status,
              m.date = entry.date,
              m.sourcePath = entry.sourcePath,
              m.line = entry.line
          WITH m
          MATCH (w:Workspace {id: $workspaceId})
          MERGE (w)-[:HAS_ENTRY]->(m)
          `,
          {
            workspaceId: this.workspaceId,
            entries: entries.index.entries,
          },
        );
      }

      const ids = entries.index.entries.map((entry) => entry.id);
      if (ids.length > 0) {
        await session.run(
          `
          MATCH (m:MemoryEntry {workspaceId: $workspaceId})
          WHERE NOT m.id IN $ids
          DETACH DELETE m
          `,
          { workspaceId: this.workspaceId, ids },
        );
      } else {
        await session.run(
          `MATCH (m:MemoryEntry {workspaceId: $workspaceId}) DETACH DELETE m`,
          { workspaceId: this.workspaceId },
        );
      }

      await session.run(
        `
        MATCH (a:MemoryEntry {workspaceId: $workspaceId})-[r:RELATES_TO]->()
        DELETE r
        `,
        { workspaceId: this.workspaceId },
      );

      if (entries.index.edges.length > 0) {
        await session.run(
          `
          UNWIND $edges AS edge
          MATCH (a:MemoryEntry {workspaceId: $workspaceId, id: edge.from})
          MATCH (b:MemoryEntry {workspaceId: $workspaceId, id: edge.to})
          MERGE (a)-[r:RELATES_TO]->(b)
          SET r.type = edge.type
          `,
          {
            workspaceId: this.workspaceId,
            edges: entries.index.edges,
          },
        );
      }
      this.dirty = false;
    } finally {
      await session.close();
    }
  }

  private async buildIndex(): Promise<{ changed: boolean; index: MemoryGraphIndex }> {
    const files = await listMemoryFiles(this.workspaceDir);
    const index: MemoryGraphIndex = { entries: [], edges: [] };
    let changed = false;
    const nextHashes = new Map<string, string>();

    for (const absPath of files) {
      const entry = await buildFileEntry(absPath, this.workspaceDir);
      nextHashes.set(entry.path, entry.hash);
      const prevHash = this.fileHashes.get(entry.path);
      if (!prevHash || prevHash !== entry.hash) changed = true;
      const parsed = await parseMemoryFile({
        absPath,
        relPath: entry.path,
      });
      index.entries.push(...parsed.entries);
      index.edges.push(...parsed.edges);
    }

    if (files.length !== this.fileHashes.size) changed = true;
    this.fileHashes = nextHashes;
    return { changed, index };
  }
}

async function parseMemoryFile(params: {
  absPath: string;
  relPath: string;
}): Promise<MemoryGraphIndex> {
  const content = await fs.readFile(params.absPath, "utf8");
  const relPath = normalizeRelPath(params.relPath);
  const base = path.basename(relPath);
  const entries: MemoryGraphEntry[] = [];
  const edges: MemoryGraphEdge[] = [];

  if (base.toLowerCase() === "memory.md") {
    return { entries, edges };
  }

  const lines = content.split(/\r?\n/);
  const dateMatch = base.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  const isDaily = Boolean(dateMatch);
  const isPreferences = base === "preferences.md";
  const isDecisions = base === "decisions.md";
  const isActive = base === "active.md";

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim().startsWith("-")) continue;
    if (isPreferences) {
      const parsed = parsePreferenceLine(line);
      if (parsed) {
        entries.push({
          ...parsed,
          sourcePath: relPath,
          line: i + 1,
        });
        if (parsed.supersededBy) {
          edges.push({
            from: parsed.id,
            to: parsed.supersededBy,
            type: "superseded_by",
          });
        }
      }
      continue;
    }
    if (isDecisions) {
      const parsed = parseDecisionLine(line);
      if (parsed) {
        entries.push({
          ...parsed,
          sourcePath: relPath,
          line: i + 1,
        });
        if (parsed.supersededBy) {
          edges.push({
            from: parsed.id,
            to: parsed.supersededBy,
            type: "superseded_by",
          });
        }
      }
      continue;
    }
    if (isActive) {
      const parsed = parseActiveLine(line);
      if (parsed) {
        entries.push({
          ...parsed,
          sourcePath: relPath,
          line: i + 1,
        });
      }
      continue;
    }
    if (isDaily) {
      const date = dateMatch?.[1];
      const text = line.replace(/^-/, "").trim();
      if (!text) continue;
      const id = `NOTE-${date}-${hashText(text).slice(0, 8)}`;
      entries.push({
        id,
        kind: "note",
        text,
        date,
        status: "active",
        sourcePath: relPath,
        line: i + 1,
      });
      continue;
    }
  }

  return { entries, edges };
}

function parsePreferenceLine(line: string): MemoryGraphEntry | null {
  const match = line.match(PREF_LINE_RE);
  if (!match) return null;
  const date = match[1];
  const id = match[2];
  const statusRaw = match[3] ?? "";
  const rest = match[4] ?? "";
  const deprecated = DEPRECATED_RE.test(line) || statusRaw.toLowerCase().includes("deprecated");
  const supersededBy = extractSupersededBy(line);
  const text = stripDeprecation(rest);
  return {
    id,
    kind: "preference",
    text,
    date,
    status: deprecated ? "deprecated" : "active",
    supersededBy,
  };
}

function parseDecisionLine(line: string): MemoryGraphEntry | null {
  const match = line.match(DEC_LINE_RE);
  if (!match) return null;
  const date = match[1];
  const id = match[2];
  const rest = match[3] ?? "";
  const deprecated = DEPRECATED_RE.test(line);
  const supersededBy = extractSupersededBy(line);
  const text = stripDeprecation(rest);
  return {
    id,
    kind: "decision",
    text,
    date,
    status: deprecated ? "deprecated" : "active",
    supersededBy,
  };
}

function parseActiveLine(line: string): MemoryGraphEntry | null {
  const match = line.match(ACTIVE_LINE_RE);
  if (!match) return null;
  const date = match[1];
  const text = match[2] ?? "";
  const id = `ACTIVE-${date}-${hashText(text).slice(0, 8)}`;
  return {
    id,
    kind: "active",
    text: text.trim(),
    date,
    status: "active",
  };
}

function stripDeprecation(text: string): string {
  return text.replace(/\s*\[DEPRECATED.*\]$/i, "").trim();
}

function extractSupersededBy(text: string): string | undefined {
  const match = text.match(SUPERSEDED_RE);
  return match?.[1];
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (neo4j.isInt(value)) return value.toNumber();
  return Number(value);
}

function toPlainProps(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    result[key] = neo4j.isInt(value) ? value.toNumber() : value;
  }
  return result;
}

function dedupeEdges(edges: MemoryGraphEdge[]): MemoryGraphEdge[] {
  const seen = new Set<string>();
  const deduped: MemoryGraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(edge);
  }
  return deduped;
}
