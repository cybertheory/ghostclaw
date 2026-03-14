import { getStreamingContent } from "./common.function";
import { Message } from "@/types";
import { getResponseSettings, RESPONSE_LENGTHS, LANGUAGES } from "@/lib";
import {
  MARKDOWN_FORMATTING_INSTRUCTIONS,
  STORAGE_KEYS,
} from "@/config/constants";
import { safeLocalStorage } from "@/lib/storage";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type OpenClawMode = "responses" | "completions";

function buildEnhancedSystemPrompt(baseSystemPrompt?: string): string {
  const responseSettings = getResponseSettings();
  const prompts: string[] = [];

  if (baseSystemPrompt) {
    prompts.push(baseSystemPrompt);
  }

  const lengthOption = RESPONSE_LENGTHS.find(
    (l) => l.id === responseSettings.responseLength
  );
  if (lengthOption?.prompt?.trim()) {
    prompts.push(lengthOption.prompt);
  }

  const languageOption = LANGUAGES.find(
    (l) => l.id === responseSettings.language
  );
  if (languageOption?.prompt?.trim()) {
    prompts.push(languageOption.prompt);
  }

  // Add markdown formatting instructions
  prompts.push(MARKDOWN_FORMATTING_INSTRUCTIONS);

  return prompts.join(" ");
}

/** Build OpenAI-format messages for OpenClaw Gateway. */
function buildOpenClawMessages(
  systemPrompt: string,
  history: Message[],
  userMessage: string,
  imagesBase64: string[] = []
): { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[] {
  const messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[] = [];
  if (systemPrompt?.trim()) {
    messages.push({ role: "system", content: systemPrompt });
  }
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }
  if (imagesBase64.length > 0) {
    const parts: { type: string; text?: string; image_url?: { url: string } }[] = [
      { type: "text", text: userMessage },
    ];
    for (const b64 of imagesBase64) {
      parts.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${b64}` },
      });
    }
    messages.push({ role: "user", content: parts });
  } else {
    messages.push({ role: "user", content: userMessage });
  }
  return messages;
}

/** Build a single prompt string for WebSocket fallback (Gateway chat has one "text" field). */
function buildOpenClawChatText(
  systemPrompt: string,
  history: Message[],
  userMessage: string
): string {
  const parts: string[] = [];
  if (systemPrompt?.trim()) {
    parts.push(systemPrompt.trim());
  }
  for (const msg of history) {
    const role = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "System";
    parts.push(`${role}: ${msg.content}`);
  }
  parts.push(`User: ${userMessage}`);
  return parts.join("\n\n");
}

/** OpenClaw Gateway WebSocket fallback (no streaming; returns full response). */
async function* fetchOpenClawViaWebSocket(params: {
  systemPrompt?: string;
  userMessage: string;
  history?: Message[];
  baseUrl: string;
  apiToken: string;
  agentId: string;
  signal?: AbortSignal;
}): AsyncIterable<string> {
  const wsUrl = params.baseUrl
    .replace(/^http:\/\//i, "ws://")
    .replace(/^https:\/\//i, "wss://")
    .replace(/\/$/, "");
  const url = params.apiToken
    ? `${wsUrl}?token=${encodeURIComponent(params.apiToken)}`
    : wsUrl;
  const text = buildOpenClawChatText(
    params.systemPrompt || "",
    params.history || [],
    params.userMessage
  );
  const result = await new Promise<string>((resolve) => {
    const ws = new WebSocket(url);
    const id = `ghostclaw-${Date.now()}`;
    let done = false;
    const finish = (value: string) => {
      if (!done) {
        done = true;
        try {
          ws.close();
        } catch {}
        resolve(value);
      }
    };
    params.signal?.addEventListener("abort", () => finish(""));
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "chat",
          id,
          payload: {
            text,
            context: {},
            options: { no_memory: false },
          },
        })
      );
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "response" && msg.id === id && msg.payload?.text != null) {
          finish(msg.payload.text as string);
        } else if (msg.type === "error" && msg.payload?.message) {
          finish(`OpenClaw error: ${msg.payload.message}`);
        }
      } catch {
        // ignore
      }
    };
    ws.onerror = () => finish("OpenClaw WebSocket connection failed.");
    ws.onclose = () => {
      if (!done) finish("OpenClaw WebSocket closed before response.");
    };
  });
  if (result) yield result;
}

/** OpenClaw OpenResponses API streaming (/v1/responses). Session-persistent and faster for follow-ups. */
async function* fetchOpenClawViaResponses(params: {
  systemPrompt?: string;
  userMessage: string;
  imagesBase64?: string[];
  history?: Message[];
  signal?: AbortSignal;
}): AsyncIterable<string> {
  const baseUrl = safeLocalStorage.getItem(STORAGE_KEYS.OPENCLAW_BASE_URL)?.trim();
  if (!baseUrl) {
    yield "OpenClaw base URL is not configured. Set it in Dashboard → OpenClaw connection.";
    return;
  }
  const apiToken = safeLocalStorage.getItem(STORAGE_KEYS.OPENCLAW_API_TOKEN)?.trim() ?? "";
  const agentId = safeLocalStorage.getItem(STORAGE_KEYS.OPENCLAW_AGENT_ID)?.trim() || "main";
  const sessionUser = safeLocalStorage.getItem(STORAGE_KEYS.OPENCLAW_SESSION_USER)?.trim() || "ghostclaw";

  const url = `${baseUrl.replace(/\/$/, "")}/v1/responses`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;
  headers["x-openclaw-agent-id"] = agentId;

  const input: { type: string; role?: string; content?: string | { type: string; text?: string; image_url?: { url: string } }[] }[] = [];
  if (params.systemPrompt?.trim()) {
    input.push({ type: "message", role: "system", content: params.systemPrompt });
  }
  for (const msg of (params.history || [])) {
    input.push({ type: "message", role: msg.role, content: msg.content });
  }
  if (params.imagesBase64?.length) {
    const parts: { type: string; text?: string; image_url?: { url: string } }[] = [
      { type: "input_text", text: params.userMessage },
    ];
    for (const b64 of params.imagesBase64) {
      parts.push({ type: "input_image", image_url: { url: `data:image/png;base64,${b64}` } } as any);
    }
    input.push({ type: "message", role: "user", content: parts as any });
  } else {
    input.push({ type: "message", role: "user", content: params.userMessage });
  }

  const body = {
    model: `openclaw:${agentId}`,
    input,
    stream: true,
    user: sessionUser,
  };

  const streamId = `oc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  type StreamChunk = { stream_id: string; data: string; done: boolean; error: string | null };

  const chunks: string[] = [];
  let streamDone = false;
  let streamError: string | null = null;
  let resolveWaiting: (() => void) | null = null;

  let unlisten: UnlistenFn | null = null;
  try {
    unlisten = await listen<StreamChunk>("openclaw-stream", (event) => {
      if (event.payload.stream_id !== streamId) return;
      if (event.payload.error) {
        streamError = event.payload.error;
        streamDone = true;
      } else if (event.payload.done) {
        streamDone = true;
      } else if (event.payload.data) {
        chunks.push(event.payload.data);
      }
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    });

    invoke("openclaw_stream", {
      streamId,
      request: { url, headers, body: JSON.stringify(body) },
    }).catch((e) => {
      streamError = e instanceof Error ? e.message : String(e);
      streamDone = true;
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    });

    let sseBuffer = "";

    while (true) {
      if (params.signal?.aborted) return;

      if (chunks.length === 0 && !streamDone) {
        await new Promise<void>((resolve) => {
          resolveWaiting = resolve;
          setTimeout(resolve, 100);
        });
        continue;
      }

      if (streamError) {
        const errMsg = streamError as string;
        if (errMsg.includes("404") || errMsg.includes("501")) {
          yield "OpenResponses endpoint not available. Enable it in OpenClaw config: gateway.http.endpoints.responses.enabled: true";
          return;
        }
        yield `OpenClaw request failed: ${errMsg}`;
        return;
      }

      while (chunks.length > 0) {
        if (params.signal?.aborted) return;
        sseBuffer += chunks.shift()!;
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const trimmed = line.substring(5).trim();
            if (!trimmed || trimmed === "[DONE]") continue;
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.type === "response.output_text.delta" && parsed.delta) {
                yield parsed.delta;
              }
            } catch {
              // partial JSON
            }
          }
        }
      }

      if (streamDone) break;
    }
  } finally {
    if (unlisten) unlisten();
  }
}

/** OpenClaw Gateway (OpenAI Chat Completions) streaming; falls back to WebSocket on 404. */
async function* fetchOpenClawViaChatCompletions(params: {
  systemPrompt?: string;
  userMessage: string;
  imagesBase64?: string[];
  history?: Message[];
  signal?: AbortSignal;
}): AsyncIterable<string> {
  const baseUrl = safeLocalStorage.getItem(STORAGE_KEYS.OPENCLAW_BASE_URL)?.trim();
  if (!baseUrl) {
    yield "OpenClaw base URL is not configured. Set it in Dashboard → OpenClaw connection.";
    return;
  }
  const apiToken = safeLocalStorage.getItem(STORAGE_KEYS.OPENCLAW_API_TOKEN)?.trim() ?? "";
  const agentId = safeLocalStorage.getItem(STORAGE_KEYS.OPENCLAW_AGENT_ID)?.trim() || "main";

  const url = `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiToken) {
    headers["Authorization"] = `Bearer ${apiToken}`;
  }
  headers["x-openclaw-agent-id"] = agentId;

  const messages = buildOpenClawMessages(
    params.systemPrompt || "",
    params.history || [],
    params.userMessage,
    params.imagesBase64 || []
  );

  const body = {
    model: agentId,
    messages,
    stream: true,
  };

  const streamId = `oc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  type StreamChunk = { stream_id: string; data: string; done: boolean; error: string | null };

  const chunks: string[] = [];
  let streamDone = false;
  let streamError: string | null = null;
  let resolveWaiting: (() => void) | null = null;

  let unlisten: UnlistenFn | null = null;
  try {
    unlisten = await listen<StreamChunk>("openclaw-stream", (event) => {
      if (event.payload.stream_id !== streamId) return;
      if (event.payload.error) {
        streamError = event.payload.error;
        streamDone = true;
      } else if (event.payload.done) {
        streamDone = true;
      } else if (event.payload.data) {
        chunks.push(event.payload.data);
      }
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    });

    invoke("openclaw_stream", {
      streamId,
      request: { url, headers, body: JSON.stringify(body) },
    }).catch((e) => {
      streamError = e instanceof Error ? e.message : String(e);
      streamDone = true;
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    });

    let sseBuffer = "";

    while (true) {
      if (params.signal?.aborted) return;

      if (chunks.length === 0 && !streamDone) {
        await new Promise<void>((resolve) => {
          resolveWaiting = resolve;
          setTimeout(resolve, 100);
        });
        continue;
      }

      if (streamError) {
        const errMsg = streamError as string;
        if (errMsg.includes("404") || errMsg.includes("501")) {
          yield* fetchOpenClawViaWebSocket({
            systemPrompt: params.systemPrompt,
            userMessage: params.userMessage,
            history: params.history,
            baseUrl,
            apiToken,
            agentId,
            signal: params.signal,
          });
          return;
        }
        yield `OpenClaw request failed: ${streamError}`;
        return;
      }

      while (chunks.length > 0) {
        if (params.signal?.aborted) return;
        sseBuffer += chunks.shift()!;
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const trimmed = line.substring(5).trim();
            if (!trimmed || trimmed === "[DONE]") continue;
            try {
              const parsed = JSON.parse(trimmed);
              const delta = getStreamingContent(parsed, "choices[0].delta.content");
              if (delta) yield delta;
            } catch {
              // partial JSON
            }
          }
        }
      }

      if (streamDone) break;
    }
  } finally {
    if (unlisten) unlisten();
  }
}

export async function* fetchAIResponse(params: {
  provider: { id?: string; streaming?: boolean; responseContentPath?: string; isCustom?: boolean; curl: string } | undefined;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  systemPrompt?: string;
  history?: Message[];
  userMessage: string;
  imagesBase64?: string[];
  signal?: AbortSignal;
}): AsyncIterable<string> {
  try {
    const { systemPrompt, history = [], userMessage, imagesBase64 = [], signal } = params;

    if (signal?.aborted) return;

    const enhancedSystemPrompt = buildEnhancedSystemPrompt(systemPrompt);
    const mode: OpenClawMode =
      (safeLocalStorage.getItem(STORAGE_KEYS.OPENCLAW_MODE) as OpenClawMode) || "responses";

    const sharedParams = {
      systemPrompt: enhancedSystemPrompt,
      userMessage,
      imagesBase64,
      history,
      signal,
    };

    if (mode === "responses") {
      yield* fetchOpenClawViaResponses(sharedParams);
    } else {
      yield* fetchOpenClawViaChatCompletions(sharedParams);
    }
  } catch (error) {
    throw new Error(
      `Error in fetchAIResponse: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
