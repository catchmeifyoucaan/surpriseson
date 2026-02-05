import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);

export function requireNodeSqlite(): typeof import("node:sqlite") {
  const onWarning = (warning: Error & { name?: string; message?: string }) => {
    if (
      warning.name === "ExperimentalWarning" &&
      warning.message?.includes("SQLite is an experimental feature")
    ) {
      return;
    }
    process.stderr.write(`${warning.stack ?? warning.toString()}\n`);
  };

  process.on("warning", onWarning);
  try {
    return require("node:sqlite") as typeof import("node:sqlite");
  } finally {
    process.off("warning", onWarning);
  }
}

export function applySqlitePragmas(db: DatabaseSync) {
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");
  db.exec("PRAGMA busy_timeout=5000;");
}
