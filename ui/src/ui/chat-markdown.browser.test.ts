import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SurprisebotApp } from "./app";

const originalConnect = SurprisebotApp.prototype.connect;

function mountApp(pathname: string) {
  window.history.replaceState({}, "", pathname);
  const app = document.createElement("surprisebot-app") as SurprisebotApp;
  document.body.append(app);
  return app;
}

beforeEach(() => {
  SurprisebotApp.prototype.connect = () => {
    // no-op: avoid real gateway WS connections in browser tests
  };
  window.__SURPRISEBOT_CONTROL_UI_BASE_PATH__ = undefined;
  localStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  SurprisebotApp.prototype.connect = originalConnect;
  window.__SURPRISEBOT_CONTROL_UI_BASE_PATH__ = undefined;
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("chat markdown rendering", () => {
  it("renders markdown inside tool result cards", async () => {
    localStorage.setItem(
      "surprisebot.control.settings.v1",
      JSON.stringify({ useNewChatLayout: false }),
    );

    const app = mountApp("/chat");
    await app.updateComplete;

    const timestamp = Date.now();
    app.chatMessages = [
      {
        role: "assistant",
        content: [
          { type: "toolcall", name: "noop", arguments: {} },
          { type: "toolresult", name: "noop", text: "Hello **world**" },
        ],
        timestamp,
      },
    ];
    // Expand the tool output card so its markdown is rendered into the DOM.
    app.toolOutputExpanded = new Set([`${timestamp}:1`]);

    await app.updateComplete;

    const strong = app.querySelector(".chat-tool-card__output strong");
    expect(strong?.textContent).toBe("world");
  });
});
