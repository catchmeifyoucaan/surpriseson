import {
  loadChannels,
  logoutWhatsApp,
  saveDiscordConfig,
  saveIMessageConfig,
  saveSlackConfig,
  saveSignalConfig,
  saveTelegramConfig,
  startWhatsAppLogin,
  waitWhatsAppLogin,
} from "./controllers/connections";
import { loadConfig } from "./controllers/config";
import type { SurprisebotApp } from "./app";

export async function handleWhatsAppStart(host: SurprisebotApp, force: boolean) {
  await startWhatsAppLogin(host, force);
  await loadChannels(host, true);
}

export async function handleWhatsAppWait(host: SurprisebotApp) {
  await waitWhatsAppLogin(host);
  await loadChannels(host, true);
}

export async function handleWhatsAppLogout(host: SurprisebotApp) {
  await logoutWhatsApp(host);
  await loadChannels(host, true);
}

export async function handleTelegramSave(host: SurprisebotApp) {
  await saveTelegramConfig(host);
  await loadConfig(host);
  await loadChannels(host, true);
}

export async function handleDiscordSave(host: SurprisebotApp) {
  await saveDiscordConfig(host);
  await loadConfig(host);
  await loadChannels(host, true);
}

export async function handleSlackSave(host: SurprisebotApp) {
  await saveSlackConfig(host);
  await loadConfig(host);
  await loadChannels(host, true);
}

export async function handleSignalSave(host: SurprisebotApp) {
  await saveSignalConfig(host);
  await loadConfig(host);
  await loadChannels(host, true);
}

export async function handleIMessageSave(host: SurprisebotApp) {
  await saveIMessageConfig(host);
  await loadConfig(host);
  await loadChannels(host, true);
}
