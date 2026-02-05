#!/usr/bin/env node
import http from "node:http";
import { TextDecoder } from "node:util";

const BIND = process.env.PROXY_BIND ?? "127.0.0.1";
const PORT = Number(process.env.PROXY_PORT ?? "3333");
const LOBECHAT_BASE_URL = (process.env.LOBECHAT_BASE_URL ?? "http://127.0.0.1:3210").replace(
  /\/+$/,
  "",
);
const ACCESS_CODE = process.env.LOBECHAT_ACCESS_CODE ?? "";
const USER_ID = process.env.LOBECHAT_USER_ID ?? "surprisebot";
const DEFAULT_PROVIDER = process.env.LOBECHAT_DEFAULT_PROVIDER ?? "google";
const DEFAULT_MODEL = process.env.LOBECHAT_DEFAULT_MODEL ?? "gemini-2.5-flash";
const INCLUDE_REASONING = process.env.LOBECHAT_INCLUDE_REASONING === "1";
const XOR_KEY = process.env.LOBECHAT_XOR_KEY ?? "LobeHub \u00b7 LobeHub";

if (!ACCESS_CODE) {
  console.error("LOBECHAT_ACCESS_CODE is required.");
  process.exit(1);
}

function xorBase64(payload, key) {
  const data = Buffer.from(JSON.stringify(payload), "utf8");
  const keyBytes = Buffer.from(key, "utf8");
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 1) {
    out[i] = data[i] ^ keyBytes[i % keyBytes.length];
  }
  return out.toString("base64");
}

function buildAuthHeader(extraPayload = {}) {
  const token = xorBase64({ accessCode: ACCESS_CODE, userId: USER_ID, ...extraPayload }, XOR_KEY);
  return token;
}

function mapProviderAndModel(model) {
  if (!model) return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
  const trimmed = String(model).trim();
  if (!trimmed) return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
  if (trimmed.includes("/")) {
    const [provider, ...rest] = trimmed.split("/");
    const id = rest.join("/") || DEFAULT_MODEL;
    return { provider, model: id };
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("gemini")) return { provider: "google", model: trimmed };
  if (lower.startsWith("gpt") || lower.startsWith("o1") || lower.startsWith("o3")) {
    return { provider: "openai", model: trimmed };
  }
  if (lower.startsWith("claude")) return { provider: "anthropic", model: trimmed };
  if (lower.startsWith("deepseek")) return { provider: "deepseek", model: trimmed };
  return { provider: DEFAULT_PROVIDER, model: trimmed };
}

function parseEventData(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function writeOpenAiChunk(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString("utf8");
  }
  if (!body) return {};
  return JSON.parse(body);
}

async function forwardToLobeChat({ reqBody, provider, model }) {
  const auth = buildAuthHeader();
  const payload = {
    ...reqBody,
    model,
    stream: true,
  };
  const response = await fetch(`${LOBECHAT_BASE_URL}/webapi/chat/${provider}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-lobe-chat-auth": auth,
    },
    body: JSON.stringify(payload),
  });
  return response;
}

async function handleStream({ lobeRes, res, openaiModel }) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const decoder = new TextDecoder();
  const reader = lobeRes.body.getReader();
  let buffer = "";
  let currentEvent = "";
  let currentId = `chat_${Date.now()}`;
  let hasToolCalls = false;

  const base = {
    id: currentId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: openaiModel,
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx === -1) break;
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) {
        currentEvent = "";
        continue;
      }
      if (line.startsWith("id:")) {
        currentId = line.slice(3).trim() || currentId;
        base.id = currentId;
        continue;
      }
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith("data:")) continue;
      const data = parseEventData(line.slice(5));

      if (currentEvent === "reasoning") {
        if (!INCLUDE_REASONING) continue;
        const text = typeof data === "string" ? data : JSON.stringify(data);
        if (!text) continue;
        writeOpenAiChunk(res, {
          ...base,
          choices: [{ index: 0, delta: { content: text } }],
        });
        continue;
      }

      if (currentEvent === "text") {
        const text = typeof data === "string" ? data : JSON.stringify(data);
        if (!text) continue;
        writeOpenAiChunk(res, {
          ...base,
          choices: [{ index: 0, delta: { content: text } }],
        });
        continue;
      }

      if (currentEvent === "tool_calls") {
        let calls = [];
        if (Array.isArray(data)) {
          calls = data;
        } else if (data) {
          calls = [data];
        }
        for (const call of calls) {
          hasToolCalls = true;
          writeOpenAiChunk(res, {
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: call.id ?? `tool_${Date.now()}`,
                      type: call.type ?? "function",
                      index: call.index ?? 0,
                      function: call.function ?? call,
                    },
                  ],
                },
              },
            ],
          });
        }
        continue;
      }

      if (currentEvent === "stop") {
        writeOpenAiChunk(res, {
          ...base,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: hasToolCalls ? "tool_calls" : "stop",
            },
          ],
        });
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
    }
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

async function handleNonStream({ lobeRes, res, openaiModel }) {
  const decoder = new TextDecoder();
  const reader = lobeRes.body.getReader();
  let buffer = "";
  let currentEvent = "";
  let text = "";
  let toolCalls = [];
  let currentId = `chat_${Date.now()}`;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx === -1) break;
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) {
        currentEvent = "";
        continue;
      }
      if (line.startsWith("id:")) {
        currentId = line.slice(3).trim() || currentId;
        continue;
      }
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith("data:")) continue;
      const data = parseEventData(line.slice(5));

      if (currentEvent === "reasoning") {
        if (!INCLUDE_REASONING) continue;
        const chunk = typeof data === "string" ? data : JSON.stringify(data);
        text += chunk;
        continue;
      }
      if (currentEvent === "text") {
        const chunk = typeof data === "string" ? data : JSON.stringify(data);
        text += chunk;
        continue;
      }
      if (currentEvent === "tool_calls") {
        const calls = Array.isArray(data) ? data : data ? [data] : [];
        toolCalls = toolCalls.concat(calls);
        continue;
      }
      if (currentEvent === "stop") {
        break;
      }
    }
  }

  const finishReason = toolCalls.length > 0 ? "tool_calls" : "stop";
  const message = {
    role: "assistant",
    content: text || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
  const response = {
    id: currentId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: openaiModel,
    choices: [{ index: 0, message, finish_reason: finishReason }],
  };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(response));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }

    if (req.method !== "POST" || !req.url?.startsWith("/v1/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const body = await readJson(req);
    const { provider, model } = mapProviderAndModel(body.model);
    const lobeRes = await forwardToLobeChat({ reqBody: body, provider, model });

    if (!lobeRes.ok) {
      const text = await lobeRes.text();
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "LobeChat upstream error",
          status: lobeRes.status,
          details: text,
        }),
      );
      return;
    }

    const openaiModel = body.model ?? `${provider}/${model}`;
    const wantsStream = body.stream !== false;
    if (wantsStream) {
      await handleStream({ lobeRes, res, openaiModel });
    } else {
      await handleNonStream({ lobeRes, res, openaiModel });
    }
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(PORT, BIND, () => {
  console.log(`Surprisebot LobeChat proxy listening on http://${BIND}:${PORT}`);
});
