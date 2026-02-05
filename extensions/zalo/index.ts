import type { SurprisebotPluginApi } from "../../src/plugins/types.js";

import { zaloDock, zaloPlugin } from "./src/channel.js";
import { handleZaloWebhookRequest } from "./src/monitor.js";

const plugin = {
  id: "zalo",
  name: "Zalo",
  description: "Zalo channel plugin (Bot API)",
  register(api: SurprisebotPluginApi) {
    api.registerChannel({ plugin: zaloPlugin, dock: zaloDock });
    api.registerHttpHandler(handleZaloWebhookRequest);
  },
};

export default plugin;
