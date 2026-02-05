import type { SurprisebotPluginApi } from "../../src/plugins/types.js";

import { matrixPlugin } from "./src/channel.js";

const plugin = {
  id: "matrix",
  name: "Matrix",
  description: "Matrix channel plugin (matrix-js-sdk)",
  register(api: SurprisebotPluginApi) {
    api.registerChannel({ plugin: matrixPlugin });
  },
};

export default plugin;
