import { html, nothing } from "lit";

import type {
  MissionControlSnapshot,
  MissionControlTaskRecord,
  MissionControlActivityRecord,
  MissionControlMessageRecord,
  MissionControlDocumentRecord,
  MissionControlBudgetLedgerRecord,
  MissionControlRunLedgerRecord,
} from "../types";
import { formatAgo } from "../format";

export type MissionControlViewProps = {
  loading: boolean;
  error: string | null;
  snapshot: MissionControlSnapshot | null;
  selectedTaskId: string | null;
  filters: { query: string; status: string; severity: string; trustTier: string };
  paging: {
    tasks: { limit: number; offset: number };
    activities: { limit: number; offset: number };
    ledger: { limit: number; runCursor?: string | null; budgetCursor?: string | null };
    incidents: { limit: number; cursor?: string | null };
  };
  denseMode: boolean;
  quickOpen: boolean;
  onSelectTask: (id: string | null) => void;
  onFiltersUpdate: (next: { query: string; status: string; severity: string; trustTier: string }) => void;
  onRefresh: () => void;
  onTaskUpdate: (id: string, patch: Record<string, unknown>) => void;
  onTaskQa: (id: string, action: "approve" | "deny") => void;
  onTaskRequeue: (id: string) => void;
  onKillSwitch: (enabled: boolean) => void;
  onBudgetMode: (mode: "soft" | "hard") => void;
  onToggleDense: () => void;
  onToggleQuick: (force?: boolean) => void;
  onPageChange: (section: "tasks" | "activities", direction: -1 | 1) => void;
  onPageJump: (section: "tasks" | "activities", page: number) => void;
  onCursorChange: (section: "incidents" | "budget-ledger" | "run-ledger", cursor: string | null) => void;
};

const TASK_LIMIT = 80;
const ACTIVITY_LIMIT = 16;
const BUDGET_LIMIT = 10;
const INCIDENT_LIMIT = 8;
const EVIDENCE_LIMIT = 8;

function normalizeList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function truncate(value: string, limit = 160) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…`;
}

function taskMatches(task: MissionControlTaskRecord, filters: MissionControlViewProps["filters"]) {
  const query = filters.query.trim().toLowerCase();
  if (query) {
    const haystack = [task.title, task.description ?? "", task.source ?? "", (task.labels ?? []).join(" ")]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.status && task.status !== filters.status) return false;
  if (filters.severity && (task.severity ?? "") !== filters.severity) return false;
  if (filters.trustTier && (task.trustTier ?? "") !== filters.trustTier) return false;
  return true;
}

function matchQuery(value: string, query: string) {
  return value.toLowerCase().includes(query);
}

function buildTaskSummary(task: MissionControlTaskRecord) {
  const chips = [task.status, task.priority, task.severity, task.trustTier]
    .filter(Boolean)
    .map((value) => String(value));
  return chips;
}

function renderEvidence(messages: MissionControlMessageRecord[], documents: MissionControlDocumentRecord[]) {
  if (messages.length === 0 && documents.length === 0) {
    return html`<div class="muted">No evidence captured yet.</div>`;
  }
  const shownMessages = messages.slice(0, EVIDENCE_LIMIT);
  const shownDocuments = documents.slice(0, EVIDENCE_LIMIT);
  return html`
    ${shownMessages.map(
      (msg) => html`
        <div class="callout" style="margin-bottom: 10px;">
          <div class="muted" style="margin-bottom: 6px;">${msg.createdAt}</div>
          <div>${truncate(msg.content, 320)}</div>
          ${msg.evidence && msg.evidence.length
            ? html`<div class="chip-row" style="margin-top: 8px;">
                ${msg.evidence.map((e) => html`<span class="chip">${e}</span>`)}
              </div>`
            : nothing}
        </div>
      `,
    )}
    ${shownDocuments.map(
      (doc) => html`
        <div class="callout" style="margin-bottom: 10px;">
          <div class="muted" style="margin-bottom: 6px;">${doc.docType}</div>
          <div>${doc.title}</div>
          <div class="mono" style="margin-top: 6px;">${doc.path}</div>
        </div>
      `,
    )}
    ${(messages.length > EVIDENCE_LIMIT || documents.length > EVIDENCE_LIMIT)
      ? html`<div class="muted">Showing latest ${EVIDENCE_LIMIT}. Export JSON for full evidence.</div>`
      : nothing}
  `;
}

function formatBudgetSnapshot(snapshot: MissionControlBudgetLedgerRecord["budgetSnapshot"]) {
  if (!snapshot) return "—";
  const raw = JSON.stringify(snapshot);
  return truncate(raw, 120);
}

function renderBudgetRows(entries: MissionControlBudgetLedgerRecord[]) {
  if (entries.length === 0) {
    return html`<div class="muted">No budget blocks recorded.</div>`;
  }
  return html`
    <div class="table mc-table">
      <div class="table-head">
        <div>When</div>
        <div>Scope</div>
        <div>Decision</div>
        <div>Reason</div>
        <div>Snapshot</div>
        <div>Scope Id</div>
      </div>
      ${entries.map(
        (entry) => html`
          <div class="table-row">
            <div class="mono">${entry.ts}</div>
            <div>${entry.scope}</div>
            <div class="mono">${entry.decision}</div>
            <div>${truncate(entry.reason ?? "", 140)}</div>
            <div class="mono">${formatBudgetSnapshot(entry.budgetSnapshot)}</div>
            <div class="mono">${entry.scopeId ?? "—"}</div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderRunRows(entries: MissionControlRunLedgerRecord[]) {
  if (entries.length === 0) {
    return html`<div class="muted">No run ledger entries.</div>`;
  }
  return html`
    <div class="mc-table">
      <div class="table-head">
        <div>ts</div>
        <div>status</div>
        <div>job</div>
        <div>agent</div>
        <div>task</div>
        <div>exit</div>
      </div>
      ${entries.map(
        (entry) => html`
          <div class="table-row">
            <div class="mono">${entry.ts}</div>
            <div>${entry.status ?? "—"}</div>
            <div class="mono">${entry.jobType ?? "—"}</div>
            <div class="mono">${entry.agentId ?? "—"}</div>
            <div class="mono">${entry.taskId ?? "—"}</div>
            <div class="mono">${entry.exitCode ?? "—"}</div>
          </div>
        `,
      )}
    </div>
  `;
}


function renderPager(
  label: string,
  offset: number,
  limit: number,
  total: number,
  onPrev: () => void,
  onNext: () => void,
  onJump?: (page: number) => void,
) {
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return html`
    <div class="mc-pager">
      <div class="muted">${label} · Page ${page} of ${totalPages}</div>
      <div class="row">
        <button class="btn btn-ghost" ?disabled=${offset === 0} @click=${onPrev}>Prev</button>
        <button class="btn btn-ghost" ?disabled=${offset + limit >= total} @click=${onNext}>Next</button>
        <label class="mc-page-jump">
          <span>Jump</span>
          <input
            type="number"
            min="1"
            max="${totalPages}"
            .value=${String(page)}
            @keydown=${(event: KeyboardEvent) => {
              if (event.key !== "Enter") return;
              const value = Number((event.target as HTMLInputElement).value);
              if (!Number.isFinite(value) || !onJump) return;
              const next = Math.max(1, Math.min(totalPages, Math.floor(value)));
              onJump(next);
            }}
            @blur=${(event: FocusEvent) => {
              const value = Number((event.target as HTMLInputElement).value);
              if (!Number.isFinite(value) || !onJump) return;
              const next = Math.max(1, Math.min(totalPages, Math.floor(value)));
              onJump(next);
            }}
          />
        </label>
      </div>
    </div>
  `;
}

function renderCursorPager(
  label: string,
  info: { cursor?: string | null; nextCursor?: string | null; hasMore?: boolean },
  onOlder: (cursor: string) => void,
  onLatest: () => void,
) {
  const hasMore = Boolean(info.hasMore && info.nextCursor);
  const isPaged = Boolean(info.cursor);
  return html`
    <div class="mc-pager">
      <div class="muted">${label} · ${isPaged ? "Paged" : "Latest"}</div>
      <div class="row">
        <button class="btn btn-ghost" ?disabled=${!hasMore} @click=${() => info.nextCursor && onOlder(info.nextCursor)}>Older</button>
        <button class="btn btn-ghost" ?disabled=${!isPaged} @click=${onLatest}>Latest</button>
      </div>
    </div>
  `;
}


export function renderMissionControl(props: MissionControlViewProps) {
  const snapshot = props.snapshot;
  const tasks = snapshot?.tasks ?? [];
  const activities = snapshot?.activities ?? [];
  const messages = snapshot?.messages ?? [];
  const documents = snapshot?.documents ?? [];
  const budgetLedger = snapshot?.budgetLedger ?? [];
  const runLedger = snapshot?.runLedger ?? [];
  const incidents = snapshot?.incidents ?? [];

  const filteredTasks = tasks.filter((task) => taskMatches(task, props.filters));
  const selectedTask = props.selectedTaskId
    ? tasks.find((task) => task.id === props.selectedTaskId) ?? null
    : null;

  const taskMessages = selectedTask
    ? messages.filter((msg) => msg.taskId === selectedTask.id)
    : [];
  const taskDocuments = selectedTask
    ? documents.filter((doc) => doc.taskId === selectedTask.id)
    : [];

  const statusCounts = tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] ?? 0) + 1;
    return acc;
  }, {});

  const severityCounts = tasks.reduce<Record<string, number>>((acc, task) => {
    const key = task.severity ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const blockedBudgets = budgetLedger.filter((entry) => entry.decision !== "allow");
  const killSwitch = Boolean((snapshot?.config?.missionControl as any)?.killSwitch);
  const budgetMode = ((snapshot?.config?.budgets as any)?.enforcement?.mode ?? "soft") as "soft" | "hard";

  const statusOptions = ["", ...Array.from(new Set(tasks.map((task) => task.status)))].filter(Boolean);
  const severityOptions = ["", ...Array.from(new Set(tasks.map((task) => task.severity ?? "")))].filter(Boolean);
  const trustOptions = ["", ...Array.from(new Set(tasks.map((task) => task.trustTier ?? "")))].filter(Boolean);

  const pageInfo = snapshot?.pageInfo ?? {};
  const tasksTotal = pageInfo.tasks?.total ?? filteredTasks.length;
  const tasksLimit = pageInfo.tasks?.limit ?? props.paging.tasks.limit;
  const tasksOffset = pageInfo.tasks?.offset ?? props.paging.tasks.offset;
  const activitiesTotal = pageInfo.activities?.total ?? activities.length;
  const activitiesLimit = pageInfo.activities?.limit ?? props.paging.activities.limit;
  const activitiesOffset = pageInfo.activities?.offset ?? props.paging.activities.offset;

  const incidentsPage = pageInfo.incidents ?? {
    limit: props.paging.incidents.limit,
    cursor: props.paging.incidents.cursor ?? null,
    nextCursor: null,
    hasMore: false,
  };
  const ledgerPage = pageInfo.ledger ?? { limit: props.paging.ledger.limit };
  const budgetPage = ledgerPage.budget ?? {
    cursor: props.paging.ledger.budgetCursor ?? null,
    nextCursor: null,
    hasMore: false,
  };
  const runPage = ledgerPage.run ?? {
    cursor: props.paging.ledger.runCursor ?? null,
    nextCursor: null,
    hasMore: false,
  };


  const activeTasks = tasks.filter((task) => ["in_progress", "review", "verified"].includes(task.status)).length;
  const backlogTasks = tasks.filter((task) => ["inbox", "assigned"].includes(task.status)).length;

  const quickQuery = props.filters.query.trim().toLowerCase();
  const quickTasks = quickQuery
    ? tasks.filter((task) => matchQuery(task.title + " " + (task.source ?? "") + " " + (task.labels ?? []).join(" "), quickQuery))
    : tasks;
  const quickIncidents = quickQuery
    ? incidents.filter((incident) => matchQuery(`${incident.summary ?? ""} ${incident.source ?? ""}`, quickQuery))
    : incidents;

  return html`
    <div class="mc-shell ${props.denseMode ? "mc-dense" : ""}">
      <section class="mc-hero card">
        <div>
          <div class="mc-hero-title">Mission Control</div>
          <div class="mc-hero-sub">Operational telemetry · Evidence-backed decisions · QA-gated execution</div>
        </div>
        <div class="mc-hero-actions">
          <button class="btn btn-ghost" @click=${() => props.onToggleQuick(true)}>Quick Search</button>
          <button class="btn btn-ghost" @click=${() => props.onToggleDense()}>${props.denseMode ? "Comfort Mode" : "Dense Mode"}</button>
        </div>
        <div class="mc-hero-meta">
          <div class="label">Snapshot</div>
          <div class="mono">${snapshot?.generatedAt ?? "—"}</div>
        </div>
      </section>

      <section class="mc-kpis">
        <div class="card stat-card">
          <div class="stat-label">Tasks</div>
          <div class="stat-value">${tasks.length}</div>
          <div class="muted">Active ${activeTasks} · Backlog ${backlogTasks}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Severity</div>
          <div class="stat-value">${Object.values(severityCounts).reduce((a, b) => a + b, 0)}</div>
          <div class="muted">${Object.entries(severityCounts)
            .map(([k, v]) => `${k}:${v}`)
            .join(" · ")}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Incidents (tail)</div>
          <div class="stat-value">${incidents.length}</div>
          <div class="muted">Showing latest ${Math.min(INCIDENT_LIMIT, incidents.length)}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Budget Blocks</div>
          <div class="stat-value">${blockedBudgets.length}</div>
          <div class="muted">Mode: ${budgetMode}</div>
        </div>
      </section>

      <section class="card mc-controls">
        <div class="card-title">Control Surface</div>
        <div class="card-sub">Mission Control gating and enforcement toggles.</div>
        <div class="form-grid" style="margin-top: 14px;">
          <label class="field">
            <span>Kill Switch</span>
            <select
              .value=${killSwitch ? "on" : "off"}
              @change=${(e: Event) => props.onKillSwitch((e.target as HTMLSelectElement).value === "on")}
            >
              <option value="off">Off</option>
              <option value="on">On</option>
            </select>
          </label>
          <label class="field">
            <span>Budget Enforcement</span>
            <select
              .value=${budgetMode}
              @change=${(e: Event) => props.onBudgetMode((e.target as HTMLSelectElement).value as "soft" | "hard")}
            >
              <option value="soft">Soft</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <label class="field">
            <span>Refresh</span>
            <button class="btn" @click=${() => props.onRefresh()}>Refresh snapshot</button>
          </label>
        </div>
        <div class="muted" style="margin-top: 10px;">Config toggles are applied on the next gateway reload.</div>
      </section>

      <section class="mc-grid">
        <div class="card">
          <div class="card-title">Ops Board</div>
          <div class="card-sub">Incidents → tasks → evidence. Select a task to inspect.</div>
          <div class="form-grid" style="margin-top: 14px;">
            <label class="field">
              <span>Search</span>
              <input
                .value=${props.filters.query}
                @input=${(e: Event) => props.onFiltersUpdate({ ...props.filters, query: (e.target as HTMLInputElement).value })}
                placeholder="Search title, labels, source"
              />
            </label>
            <label class="field">
              <span>Status</span>
              <select
                .value=${props.filters.status}
                @change=${(e: Event) => props.onFiltersUpdate({ ...props.filters, status: (e.target as HTMLSelectElement).value })}
              >
                <option value="">All</option>
                ${statusOptions.map((status) => html`<option value=${status}>${status}</option>`)}
              </select>
            </label>
            <label class="field">
              <span>Severity</span>
              <select
                .value=${props.filters.severity}
                @change=${(e: Event) => props.onFiltersUpdate({ ...props.filters, severity: (e.target as HTMLSelectElement).value })}
              >
                <option value="">All</option>
                ${severityOptions.map((sev) => html`<option value=${sev}>${sev || "unknown"}</option>`)}
              </select>
            </label>
            <label class="field">
              <span>Trust Tier</span>
              <select
                .value=${props.filters.trustTier}
                @change=${(e: Event) => props.onFiltersUpdate({ ...props.filters, trustTier: (e.target as HTMLSelectElement).value })}
              >
                <option value="">All</option>
                ${trustOptions.map((tier) => html`<option value=${tier}>${tier || "unknown"}</option>`)}
              </select>
            </label>
          </div>
          ${props.loading
            ? html`<div class="muted" style="margin-top: 14px;">Loading tasks…</div>`
            : nothing}
          ${props.error ? html`<div class="callout danger" style="margin-top: 14px;">${props.error}</div>` : nothing}
          ${renderPager(
            "Tasks",
            tasksOffset,
            tasksLimit,
            Math.max(tasksTotal, tasksLimit),
            () => props.onPageChange("tasks", -1),
            () => props.onPageChange("tasks", 1),
            (page) => props.onPageJump("tasks", page),
          )}
          <div class="mc-list-meta">Showing ${Math.min(filteredTasks.length, TASK_LIMIT)} of ${filteredTasks.length} tasks</div>
          <div class="list mc-scroll" style="margin-top: 10px;">
            ${filteredTasks.length === 0
              ? html`<div class="muted">No tasks match the current filters.</div>`
              : filteredTasks.slice(0, TASK_LIMIT).map((task) => {
                  const chips = buildTaskSummary(task);
                  const selected = task.id === props.selectedTaskId;
                  return html`
                    <div
                      class="list-item list-item-clickable ${selected ? "list-item-selected" : ""}"
                      @click=${() => props.onSelectTask(selected ? null : task.id)}
                    >
                      <div class="list-main">
                        <div class="list-title">${task.title}</div>
                        <div class="list-sub">${task.source ?? "unknown source"} · ${task.updatedAt}</div>
                        <div class="chip-row">
                          ${chips.map((chip) => html`<span class="chip">${chip}</span>`)}
                        </div>
                      </div>
                      <div class="list-meta">
                        <div class="mono">${task.id}</div>
                        <div>${(task.assignees ?? []).join(", ") || "unassigned"}</div>
                        <div>${(task.labels ?? []).join(", ") || "no labels"}</div>
                      </div>
                    </div>
                  `;
                })}
          </div>
        </div>

        <div class="card" data-task-panel>
          <div class="card-title">Evidence Panel</div>
          <div class="card-sub">Inspect selected task, evidence, and QA actions.</div>
          ${selectedTask
            ? html`
                <div class="note-grid" style="margin-top: 16px;">
                  <div>
                    <div class="note-title">${selectedTask.title}</div>
                    <div class="muted">${selectedTask.description ?? "No description provided."}</div>
                  </div>
                  <div>
                    <div class="note-title">Status</div>
                    <div class="muted">${selectedTask.status}</div>
                  </div>
                  <div>
                    <div class="note-title">Trust Tier</div>
                    <div class="muted">${selectedTask.trustTier ?? "n/a"}</div>
                  </div>
                </div>
                <div class="form-grid" style="margin-top: 14px;">
                  <label class="field">
                    <span>Status</span>
                    <select name="status" .value=${selectedTask.status}>
                      ${["inbox", "assigned", "in_progress", "review", "verified", "done", "blocked", "cancelled"].map(
                        (status) => html`<option value=${status}>${status}</option>`,
                      )}
                    </select>
                  </label>
                  <label class="field">
                    <span>Priority</span>
                    <select name="priority" .value=${selectedTask.priority}>
                      ${["low", "medium", "high", "critical"].map(
                        (priority) => html`<option value=${priority}>${priority}</option>`,
                      )}
                    </select>
                  </label>
                  <label class="field">
                    <span>Assignees</span>
                    <input name="assignees" .value=${(selectedTask.assignees ?? []).join(", ")} placeholder="agent ids" />
                  </label>
                  <label class="field">
                    <span>Labels</span>
                    <input name="labels" .value=${(selectedTask.labels ?? []).join(", ")} placeholder="comma separated" />
                  </label>
                </div>
                <div class="row" style="margin-top: 12px;">
                  <button
                    class="btn"
                    @click=${(e: Event) => {
                      const root = (e.currentTarget as HTMLElement).closest('[data-task-panel]') as HTMLElement | null;
                      if (!root) return;
                      const status = (root.querySelector('select[name="status"]') as HTMLSelectElement | null)?.value;
                      const priority = (root.querySelector('select[name="priority"]') as HTMLSelectElement | null)?.value;
                      const assigneesRaw = (root.querySelector('input[name="assignees"]') as HTMLInputElement | null)?.value ?? "";
                      const labelsRaw = (root.querySelector('input[name="labels"]') as HTMLInputElement | null)?.value ?? "";
                      props.onTaskUpdate(selectedTask.id, {
                        status,
                        priority,
                        assignees: normalizeList(assigneesRaw),
                        labels: normalizeList(labelsRaw),
                      });
                    }}
                  >
                    Save changes
                  </button>
                  <button class="btn" @click=${() => props.onTaskRequeue(selectedTask.id)}>Requeue</button>
                  <button class="btn" @click=${() => props.onTaskQa(selectedTask.id, "approve")}>Approve</button>
                  <button class="btn" @click=${() => props.onTaskQa(selectedTask.id, "deny")}>Deny</button>
                </div>
                <div style="margin-top: 16px;">
                  <div class="card-title">Evidence</div>
                  ${renderEvidence(taskMessages, taskDocuments)}
                </div>
              `
            : html`<div class="muted" style="margin-top: 16px;">Select a task to inspect evidence and actions.</div>`}
        </div>
      </section>

      <section class="mc-grid">
        <div class="card">
          <div class="card-title">Activity Feed</div>
          <div class="card-sub">Latest activity entries from the ledger.</div>
          ${renderPager(
            "Activities",
            activitiesOffset,
            activitiesLimit,
            Math.max(activitiesTotal, activitiesLimit),
            () => props.onPageChange("activities", -1),
            () => props.onPageChange("activities", 1),
            (page) => props.onPageJump("activities", page),
          )}
          <div class="mc-list-meta">Showing latest ${Math.min(activities.length, ACTIVITY_LIMIT)} entries</div>
          <div class="list mc-scroll" style="margin-top: 10px;">
            ${activities.length === 0
              ? html`<div class="muted">No activities yet.</div>`
              : activities.slice(0, ACTIVITY_LIMIT).map((activity) => html`
                  <div class="list-item">
                    <div class="list-main">
                      <div class="list-title">${truncate(activity.message, 180)}</div>
                      <div class="list-sub">${activity.type}</div>
                    </div>
                    <div class="list-meta">
                      <div>${formatAgo(Date.parse(activity.createdAt))}</div>
                      <div class="mono">${activity.taskId ?? "—"}</div>
                    </div>
                  </div>
                `)}
          </div>
        </div>

        <div class="card">
          <div class="card-title">Budget & Decisions</div>
          <div class="card-sub">Blocked or throttled runs and their reasons.</div>
          ${renderCursorPager(
            "Budget Ledger",
            budgetPage,
            (cursor) => props.onCursorChange("budget-ledger", cursor),
            () => props.onCursorChange("budget-ledger", null),
          )}
          <div class="mc-list-meta">Showing latest ${Math.min(blockedBudgets.length, BUDGET_LIMIT)} entries</div>
          <div class="mc-scroll" style="margin-top: 10px;">
            ${renderBudgetRows(blockedBudgets.slice(0, BUDGET_LIMIT))}
          </div>
        </div>

        <div class="card">
          <div class="card-title">Run Ledger</div>
          <div class="card-sub">Latest job runs and exit statuses.</div>
          ${renderCursorPager(
            "Run Ledger",
            runPage,
            (cursor) => props.onCursorChange("run-ledger", cursor),
            () => props.onCursorChange("run-ledger", null),
          )}
          <div class="mc-list-meta">Showing latest ${Math.min(runLedger.length, BUDGET_LIMIT)} entries</div>
          <div class="mc-scroll" style="margin-top: 10px;">
            ${renderRunRows(runLedger.slice(0, BUDGET_LIMIT))}
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-title">Incident Tail</div>
        <div class="card-sub">Latest incident entries for rapid triage.</div>
        ${renderCursorPager(
          "Incidents",
          incidentsPage,
          (cursor) => props.onCursorChange("incidents", cursor),
          () => props.onCursorChange("incidents", null),
        )}
        <div class="list mc-scroll" style="margin-top: 10px;">
          ${incidents.length === 0
            ? html`<div class="muted">No incidents recorded.</div>`
            : incidents.slice(0, INCIDENT_LIMIT).map((incident) => html`
                <div class="list-item">
                  <div class="list-main">
                    <div class="list-title">${truncate(incident.summary ?? "", 160)}</div>
                    <div class="list-sub">${incident.source} · ${incident.severity}</div>
                  </div>
                  <div class="list-meta">
                    <div>${incident.createdAt}</div>
                    <div class="mono">${incident.id}</div>
                  </div>
                </div>
              `)}
        </div>
      </section>

      <section class="card">
        <div class="card-title">Audit Export</div>
        <div class="card-sub">Download a snapshot of the current Mission Control state.</div>
        <div class="row" style="margin-top: 12px;">
          <button
            class="btn"
            @click=${() => {
              const payload = JSON.stringify(snapshot ?? {}, null, 2);
              const blob = new Blob([payload], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `mission-control-${Date.now()}.json`;
              anchor.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export JSON
          </button>
        </div>
      </section>
    </div>

    <div class="mc-quick ${props.quickOpen ? "open" : ""}" @click=${() => props.onToggleQuick(false)}>
      <div class="mc-quick-panel" @click=${(e: Event) => e.stopPropagation()}>
        <div class="mc-quick-title">Quick Search</div>
        <input
          class="mc-quick-input"
          .value=${props.filters.query}
          @input=${(e: Event) => props.onFiltersUpdate({ ...props.filters, query: (e.target as HTMLInputElement).value })}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Escape") props.onToggleQuick(false);
          }}
          placeholder="Type to filter tasks + incidents"
        />
        <div class="mc-quick-grid">
          <div>
            <div class="label">Tasks</div>
            <div class="mc-quick-list">
              ${quickTasks.slice(0, 8).map(
                (task) => html`<button class="mc-quick-item" @click=${() => { props.onSelectTask(task.id); props.onToggleQuick(false); }}>
                  <div>${truncate(task.title, 140)}</div>
                  <div class="muted">${task.status} · ${task.severity ?? "n/a"}</div>
                </button>`
              )}
            </div>
          </div>
          <div>
            <div class="label">Incidents</div>
            <div class="mc-quick-list">
              ${quickIncidents.slice(0, 8).map(
                (incident) => html`<div class="mc-quick-item">
                  <div>${truncate(incident.summary ?? "", 140)}</div>
                  <div class="muted">${incident.source} · ${incident.severity}</div>
                </div>`
              )}
            </div>
          </div>
        </div>
        <div class="mc-quick-hint">Press Esc to close · Ctrl+K or / to open.</div>
      </div>
    </div>
  `;
}
