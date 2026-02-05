const URL_RE = /https?:\/\/[^\s)]+/gi;
const KEY_PATTERNS: Array<{ re: RegExp; score: number; label: string }> = [
  { re: /AKIA[0-9A-Z]{16}/g, score: 35, label: "aws_access_key" },
  { re: /ASIA[0-9A-Z]{16}/g, score: 30, label: "aws_temp_key" },
  { re: /BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY/g, score: 40, label: "private_key" },
  { re: /xox[baprs]-[0-9A-Za-z-]{10,}/g, score: 30, label: "slack_token" },
  { re: /api[_-]?key\s*[:=]\s*[A-Za-z0-9_-]{16,}/gi, score: 20, label: "api_key" },
  { re: /secret\s*[:=]\s*[A-Za-z0-9_-]{12,}/gi, score: 15, label: "secret" },
  { re: /password\s*[:=]\s*[^\s]{6,}/gi, score: 15, label: "password" },
  { re: /token\s*[:=]\s*[A-Za-z0-9._-]{12,}/gi, score: 15, label: "token" },
  { re: /aws_secret_access_key/gi, score: 30, label: "aws_secret" },
  { re: /authorization: bearer\s+[A-Za-z0-9._-]+/gi, score: 20, label: "bearer_token" },
];

const HIGH_SIGNAL_WORDS = ["credential", "leak", "exposed", "public", "backup", "dump", "database", "admin"];

export type SignalScore = {
  score: number;
  evidenceCount: number;
  reasons: string[];
};

export function scoreSignal(text: string): SignalScore {
  const reasons: string[] = [];
  let score = 0;
  const matches: string[] = [];

  for (const pattern of KEY_PATTERNS) {
    const m = text.match(pattern.re);
    if (m && m.length > 0) {
      score += pattern.score;
      reasons.push(pattern.label);
      matches.push(...m);
    }
  }

  const urls = text.match(URL_RE) ?? [];
  const evidenceCount = new Set(urls).size + matches.length;

  for (const word of HIGH_SIGNAL_WORDS) {
    if (text.toLowerCase().includes(word)) {
      score += 5;
      reasons.push(word);
    }
  }

  if (evidenceCount >= 2) score += 10;
  if (evidenceCount >= 5) score += 10;

  if (score > 100) score = 100;
  return { score, evidenceCount, reasons };
}
