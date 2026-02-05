import { createSubsystemLogger } from "../logging.js";

export type JobContext = {
  sessionKey: string;
  jobType?: string | null;
  runId?: string | null;
  startedAtMs: number;
  queryCount: number;
};

const log = createSubsystemLogger("gateway/job-context");
const JOB_CONTEXT = new Map<string, JobContext>();

export function registerJobContext(params: {
  sessionKey: string;
  jobType?: string | null;
  runId?: string | null;
}) {
  const entry: JobContext = {
    sessionKey: params.sessionKey,
    jobType: params.jobType ?? null,
    runId: params.runId ?? null,
    startedAtMs: Date.now(),
    queryCount: 0,
  };
  JOB_CONTEXT.set(params.sessionKey, entry);
  log.debug("job context registered", { sessionKey: params.sessionKey, jobType: params.jobType });
}

export function getJobContext(sessionKey?: string | null): JobContext | null {
  if (!sessionKey) return null;
  return JOB_CONTEXT.get(sessionKey) ?? null;
}

export function incrementJobQueryCount(sessionKey?: string | null): number | null {
  if (!sessionKey) return null;
  const entry = JOB_CONTEXT.get(sessionKey);
  if (!entry) return null;
  entry.queryCount += 1;
  JOB_CONTEXT.set(sessionKey, entry);
  return entry.queryCount;
}

export function clearJobContext(sessionKey?: string | null) {
  if (!sessionKey) return;
  JOB_CONTEXT.delete(sessionKey);
}
