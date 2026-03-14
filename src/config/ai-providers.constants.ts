import type { TYPE_PROVIDER } from "@/types";

/** Single built-in AI provider: OpenClaw Gateway (OpenAI-compatible). */
export const OPENCLAW_PROVIDER_ID = "openclaw" as const;

/** Placeholder provider for context; actual requests use OpenClaw config from storage. */
export const OPENCLAW_PROVIDER: TYPE_PROVIDER = {
  id: OPENCLAW_PROVIDER_ID,
  streaming: true,
  responseContentPath: "choices[0].delta.content",
  curl: "",
};

/** No longer used (OpenClaw-only); kept for backward compat with code that imports AI_PROVIDERS. */
export const AI_PROVIDERS: TYPE_PROVIDER[] = [];
