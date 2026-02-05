import type { Skill } from "@mariozechner/pi-coding-agent";

import type {
  SurprisebotSkillMetadata,
  ParsedSkillFrontmatter,
  SkillEntry,
  SkillInstallSpec,
} from "./types.js";

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseFrontmatter(content: string): ParsedSkillFrontmatter {
  const frontmatter: ParsedSkillFrontmatter = {};
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return frontmatter;
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) return frontmatter;
  const block = normalized.slice(4, endIndex);
  for (const line of block.split("\n")) {
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = stripQuotes(match[2].trim());
    if (!key || !value) continue;
    frontmatter[key] = value;
  }
  return frontmatter;
}

function normalizeStringList(input: unknown): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function parseInstallSpec(input: unknown): SkillInstallSpec | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const kindRaw =
    typeof raw.kind === "string" ? raw.kind : typeof raw.type === "string" ? raw.type : "";
  const kind = kindRaw.trim().toLowerCase();
  if (kind !== "brew" && kind !== "node" && kind !== "go" && kind !== "uv") {
    return undefined;
  }

  const spec: SkillInstallSpec = {
    kind: kind as SkillInstallSpec["kind"],
  };

  if (typeof raw.id === "string") spec.id = raw.id;
  if (typeof raw.label === "string") spec.label = raw.label;
  const bins = normalizeStringList(raw.bins);
  if (bins.length > 0) spec.bins = bins;
  if (typeof raw.formula === "string") spec.formula = raw.formula;
  if (typeof raw.package === "string") spec.package = raw.package;
  if (typeof raw.module === "string") spec.module = raw.module;

  return spec;
}

function getFrontmatterValue(frontmatter: ParsedSkillFrontmatter, key: string): string | undefined {
  const raw = frontmatter[key];
  return typeof raw === "string" ? raw : undefined;
}

export function resolveSurprisebotMetadata(
  frontmatter: ParsedSkillFrontmatter,
): SurprisebotSkillMetadata | undefined {
  const raw = getFrontmatterValue(frontmatter, "metadata");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { surprisebot?: unknown };
    if (!parsed || typeof parsed !== "object") return undefined;
    const surprisebot = (parsed as { surprisebot?: unknown }).surprisebot;
    if (!surprisebot || typeof surprisebot !== "object") return undefined;
    const surprisebotObj = surprisebot as Record<string, unknown>;
    const requiresRaw =
      typeof surprisebotObj.requires === "object" && surprisebotObj.requires !== null
        ? (surprisebotObj.requires as Record<string, unknown>)
        : undefined;
    const installRaw = Array.isArray(surprisebotObj.install) ? (surprisebotObj.install as unknown[]) : [];
    const install = installRaw
      .map((entry) => parseInstallSpec(entry))
      .filter((entry): entry is SkillInstallSpec => Boolean(entry));
    const osRaw = normalizeStringList(surprisebotObj.os);
    return {
      always: typeof surprisebotObj.always === "boolean" ? surprisebotObj.always : undefined,
      emoji: typeof surprisebotObj.emoji === "string" ? surprisebotObj.emoji : undefined,
      homepage: typeof surprisebotObj.homepage === "string" ? surprisebotObj.homepage : undefined,
      skillKey: typeof surprisebotObj.skillKey === "string" ? surprisebotObj.skillKey : undefined,
      primaryEnv: typeof surprisebotObj.primaryEnv === "string" ? surprisebotObj.primaryEnv : undefined,
      os: osRaw.length > 0 ? osRaw : undefined,
      requires: requiresRaw
        ? {
            bins: normalizeStringList(requiresRaw.bins),
            anyBins: normalizeStringList(requiresRaw.anyBins),
            env: normalizeStringList(requiresRaw.env),
            config: normalizeStringList(requiresRaw.config),
          }
        : undefined,
      install: install.length > 0 ? install : undefined,
    };
  } catch {
    return undefined;
  }
}

export function resolveSkillKey(skill: Skill, entry?: SkillEntry): string {
  return entry?.surprisebot?.skillKey ?? skill.name;
}
