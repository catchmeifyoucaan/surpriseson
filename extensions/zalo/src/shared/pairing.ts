export const PAIRING_APPROVED_MESSAGE =
  "\u2705 Surprisebot access approved. Send a message to start chatting.";

export function formatPairingApproveHint(channelId: string): string {
  return `Approve via: surprisebot pairing list ${channelId} / surprisebot pairing approve ${channelId} <code>`;
}
