import { createSubsystemLogger } from "../logging.js";
import type { SurprisebotConfig } from "../config/config.js";
import { resolveHeartbeatDeliveryTarget } from "./outbound/targets.js";
import { deliverOutboundPayloads } from "./outbound/deliver.js";
import { enqueueSystemEvent } from "./system-events.js";
import { requestHeartbeatNow } from "./heartbeat-wake.js";
import { resolveMainSessionKey } from "../config/sessions.js";

const log = createSubsystemLogger("gateway/restart-announce");
const DEFAULT_DELAY_MS = 10_000;

export function scheduleRestartAnnouncement(cfg: SurprisebotConfig) {
  const target = resolveHeartbeatDeliveryTarget({ cfg });
  if (target.channel === "none" || !target.to) {
    log.info("restart announcement skipped (no heartbeat target)");
    return;
  }
  const to = target.to;

  const sessionKey = resolveMainSessionKey(cfg);
  enqueueSystemEvent("Gateway restart: send confirmation 'I'm back up'.", {
    sessionKey,
    contextKey: "gateway:restart",
  });
  requestHeartbeatNow({ reason: "gateway-restart", coalesceMs: 1_000 });

  const timer = setTimeout(() => {
    void deliverOutboundPayloads({
      cfg,
      channel: target.channel,
      to,
      payloads: [
        {
          text:
            "Summary: I'm back up.\nEvidence: gateway restart completed.\nNext action: None.",
        },
      ],
      bestEffort: true,
      onError: (err) => {
        log.warn(`restart announcement failed: ${String(err)}`);
      },
    }).catch((err) => log.warn(`restart announcement error: ${String(err)}`));
  }, DEFAULT_DELAY_MS);
  timer.unref?.();
}
