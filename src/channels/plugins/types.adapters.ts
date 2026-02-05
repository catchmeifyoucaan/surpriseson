import type { SurprisebotConfig } from "../../config/config.js";
import type { OutboundDeliveryResult, OutboundSendDeps } from "../../infra/outbound/deliver.js";
import type { RuntimeEnv } from "../../runtime.js";
import type {
  ChannelAccountSnapshot,
  ChannelAccountState,
  ChannelGroupContext,
  ChannelHeartbeatDeps,
  ChannelLogSink,
  ChannelOutboundTargetMode,
  ChannelPollContext,
  ChannelPollResult,
  ChannelSecurityContext,
  ChannelSecurityDmPolicy,
  ChannelSetupInput,
  ChannelStatusIssue,
} from "./types.core.js";

export type ChannelSetupAdapter = {
  resolveAccountId?: (params: { cfg: SurprisebotConfig; accountId?: string }) => string;
  applyAccountName?: (params: {
    cfg: SurprisebotConfig;
    accountId: string;
    name?: string;
  }) => SurprisebotConfig;
  applyAccountConfig: (params: {
    cfg: SurprisebotConfig;
    accountId: string;
    input: ChannelSetupInput;
  }) => SurprisebotConfig;
  validateInput?: (params: {
    cfg: SurprisebotConfig;
    accountId: string;
    input: ChannelSetupInput;
  }) => string | null;
};

export type ChannelConfigAdapter<ResolvedAccount> = {
  listAccountIds: (cfg: SurprisebotConfig) => string[];
  resolveAccount: (cfg: SurprisebotConfig, accountId?: string | null) => ResolvedAccount;
  defaultAccountId?: (cfg: SurprisebotConfig) => string;
  setAccountEnabled?: (params: {
    cfg: SurprisebotConfig;
    accountId: string;
    enabled: boolean;
  }) => SurprisebotConfig;
  deleteAccount?: (params: { cfg: SurprisebotConfig; accountId: string }) => SurprisebotConfig;
  isEnabled?: (account: ResolvedAccount, cfg: SurprisebotConfig) => boolean;
  disabledReason?: (account: ResolvedAccount, cfg: SurprisebotConfig) => string;
  isConfigured?: (account: ResolvedAccount, cfg: SurprisebotConfig) => boolean | Promise<boolean>;
  unconfiguredReason?: (account: ResolvedAccount, cfg: SurprisebotConfig) => string;
  describeAccount?: (account: ResolvedAccount, cfg: SurprisebotConfig) => ChannelAccountSnapshot;
  resolveAllowFrom?: (params: {
    cfg: SurprisebotConfig;
    accountId?: string | null;
  }) => string[] | undefined;
  formatAllowFrom?: (params: {
    cfg: SurprisebotConfig;
    accountId?: string | null;
    allowFrom: Array<string | number>;
  }) => string[];
};

export type ChannelGroupAdapter = {
  resolveRequireMention?: (params: ChannelGroupContext) => boolean | undefined;
  resolveGroupIntroHint?: (params: ChannelGroupContext) => string | undefined;
};

export type ChannelOutboundContext = {
  cfg: SurprisebotConfig;
  to: string;
  text: string;
  mediaUrl?: string;
  gifPlayback?: boolean;
  replyToId?: string | null;
  threadId?: string | number | null;
  accountId?: string | null;
  deps?: OutboundSendDeps;
};

export type ChannelOutboundAdapter = {
  deliveryMode: "direct" | "gateway" | "hybrid";
  chunker?: ((text: string, limit: number) => string[]) | null;
  textChunkLimit?: number;
  pollMaxOptions?: number;
  resolveTarget?: (params: {
    cfg?: SurprisebotConfig;
    to?: string;
    allowFrom?: string[];
    accountId?: string | null;
    mode?: ChannelOutboundTargetMode;
  }) => { ok: true; to: string } | { ok: false; error: Error };
  sendText?: (ctx: ChannelOutboundContext) => Promise<OutboundDeliveryResult>;
  sendMedia?: (ctx: ChannelOutboundContext) => Promise<OutboundDeliveryResult>;
  sendPoll?: (ctx: ChannelPollContext) => Promise<ChannelPollResult>;
};

export type ChannelStatusAdapter<ResolvedAccount> = {
  defaultRuntime?: ChannelAccountSnapshot;
  buildChannelSummary?: (params: {
    account: ResolvedAccount;
    cfg: SurprisebotConfig;
    defaultAccountId: string;
    snapshot: ChannelAccountSnapshot;
  }) => Record<string, unknown> | Promise<Record<string, unknown>>;
  probeAccount?: (params: {
    account: ResolvedAccount;
    timeoutMs: number;
    cfg: SurprisebotConfig;
  }) => Promise<unknown>;
  auditAccount?: (params: {
    account: ResolvedAccount;
    timeoutMs: number;
    cfg: SurprisebotConfig;
    probe?: unknown;
  }) => Promise<unknown>;
  buildAccountSnapshot?: (params: {
    account: ResolvedAccount;
    cfg: SurprisebotConfig;
    runtime?: ChannelAccountSnapshot;
    probe?: unknown;
    audit?: unknown;
  }) => ChannelAccountSnapshot | Promise<ChannelAccountSnapshot>;
  logSelfId?: (params: {
    account: ResolvedAccount;
    cfg: SurprisebotConfig;
    runtime: RuntimeEnv;
    includeChannelPrefix?: boolean;
  }) => void;
  resolveAccountState?: (params: {
    account: ResolvedAccount;
    cfg: SurprisebotConfig;
    configured: boolean;
    enabled: boolean;
  }) => ChannelAccountState;
  collectStatusIssues?: (accounts: ChannelAccountSnapshot[]) => ChannelStatusIssue[];
};

export type ChannelGatewayContext<ResolvedAccount = unknown> = {
  cfg: SurprisebotConfig;
  accountId: string;
  account: ResolvedAccount;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  log?: ChannelLogSink;
  getStatus: () => ChannelAccountSnapshot;
  setStatus: (next: ChannelAccountSnapshot) => void;
};

export type ChannelLogoutResult = {
  cleared: boolean;
  loggedOut?: boolean;
  [key: string]: unknown;
};

export type ChannelLoginWithQrStartResult = {
  qrDataUrl?: string;
  message: string;
};

export type ChannelLoginWithQrWaitResult = {
  connected: boolean;
  message: string;
};

export type ChannelLogoutContext<ResolvedAccount = unknown> = {
  cfg: SurprisebotConfig;
  accountId: string;
  account: ResolvedAccount;
  runtime: RuntimeEnv;
  log?: ChannelLogSink;
};

export type ChannelPairingAdapter = {
  idLabel: string;
  normalizeAllowEntry?: (entry: string) => string;
  notifyApproval?: (params: {
    cfg: SurprisebotConfig;
    id: string;
    runtime?: RuntimeEnv;
  }) => Promise<void>;
};

export type ChannelGatewayAdapter<ResolvedAccount = unknown> = {
  startAccount?: (ctx: ChannelGatewayContext<ResolvedAccount>) => Promise<unknown>;
  stopAccount?: (ctx: ChannelGatewayContext<ResolvedAccount>) => Promise<void>;
  loginWithQrStart?: (params: {
    accountId?: string;
    force?: boolean;
    timeoutMs?: number;
    verbose?: boolean;
  }) => Promise<ChannelLoginWithQrStartResult>;
  loginWithQrWait?: (params: {
    accountId?: string;
    timeoutMs?: number;
  }) => Promise<ChannelLoginWithQrWaitResult>;
  logoutAccount?: (ctx: ChannelLogoutContext<ResolvedAccount>) => Promise<ChannelLogoutResult>;
};

export type ChannelAuthAdapter = {
  login?: (params: {
    cfg: SurprisebotConfig;
    accountId?: string | null;
    runtime: RuntimeEnv;
    verbose?: boolean;
    channelInput?: string | null;
  }) => Promise<void>;
};

export type ChannelHeartbeatAdapter = {
  checkReady?: (params: {
    cfg: SurprisebotConfig;
    accountId?: string | null;
    deps?: ChannelHeartbeatDeps;
  }) => Promise<{ ok: boolean; reason: string }>;
  resolveRecipients?: (params: { cfg: SurprisebotConfig; opts?: { to?: string; all?: boolean } }) => {
    recipients: string[];
    source: string;
  };
};

export type ChannelElevatedAdapter = {
  allowFromFallback?: (params: {
    cfg: SurprisebotConfig;
    accountId?: string | null;
  }) => Array<string | number> | undefined;
};

export type ChannelCommandAdapter = {
  enforceOwnerForCommands?: boolean;
  skipWhenConfigEmpty?: boolean;
};

export type ChannelSecurityAdapter<ResolvedAccount = unknown> = {
  resolveDmPolicy?: (
    ctx: ChannelSecurityContext<ResolvedAccount>,
  ) => ChannelSecurityDmPolicy | null;
  collectWarnings?: (ctx: ChannelSecurityContext<ResolvedAccount>) => Promise<string[]> | string[];
};
