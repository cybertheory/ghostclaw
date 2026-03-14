import { useState, useEffect } from "react";
import { LoaderIcon, ServerIcon, ZapIcon, NetworkIcon } from "lucide-react";
import { safeLocalStorage } from "@/lib/storage";
import { STORAGE_KEYS } from "@/config/constants";
import { Button, Header, Input } from "@/components";
import { invoke } from "@tauri-apps/api/core";
import type { OpenClawMode } from "@/lib/functions/ai-response.function";

const DEFAULT_AGENT_ID = "main";

const MODES: { id: OpenClawMode; label: string; description: string }[] = [
  {
    id: "responses",
    label: "OpenResponses",
    description: "Session-persistent, faster follow-ups, richer streaming",
  },
  {
    id: "completions",
    label: "Chat Completions",
    description: "Standard OpenAI-compatible endpoint, stateless per request",
  },
];

export const OpenClawConnection = () => {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [agentId, setAgentId] = useState(DEFAULT_AGENT_ID);
  const [mode, setMode] = useState<OpenClawMode>("responses");
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "error" | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const url = safeLocalStorage.getItem(STORAGE_KEYS.OPENCLAW_BASE_URL) ?? "";
    const token = safeLocalStorage.getItem(STORAGE_KEYS.OPENCLAW_API_TOKEN) ?? "";
    const agent = safeLocalStorage.getItem(STORAGE_KEYS.OPENCLAW_AGENT_ID) ?? DEFAULT_AGENT_ID;
    const storedMode = safeLocalStorage.getItem(STORAGE_KEYS.OPENCLAW_MODE) as OpenClawMode | null;
    setBaseUrl(url);
    setApiToken(token);
    setAgentId(agent || DEFAULT_AGENT_ID);
    setMode(storedMode || "responses");
  }, []);

  const save = () => {
    const url = baseUrl.trim();
    const token = apiToken.trim();
    const agent = agentId.trim() || DEFAULT_AGENT_ID;
    if (url) {
      safeLocalStorage.setItem(STORAGE_KEYS.OPENCLAW_BASE_URL, url);
    } else {
      safeLocalStorage.removeItem(STORAGE_KEYS.OPENCLAW_BASE_URL);
    }
    if (token) {
      safeLocalStorage.setItem(STORAGE_KEYS.OPENCLAW_API_TOKEN, token);
    } else {
      safeLocalStorage.removeItem(STORAGE_KEYS.OPENCLAW_API_TOKEN);
    }
    safeLocalStorage.setItem(STORAGE_KEYS.OPENCLAW_AGENT_ID, agent);
    safeLocalStorage.setItem(STORAGE_KEYS.OPENCLAW_MODE, mode);
    setSaved(true);
    setTestResult(null);
    setTestError(null);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleModeChange = (newMode: OpenClawMode) => {
    setMode(newMode);
    safeLocalStorage.setItem(STORAGE_KEYS.OPENCLAW_MODE, newMode);
    setTestResult(null);
    setTestError(null);
  };

  const testConnection = async () => {
    const url = baseUrl.trim();
    if (!url) {
      setTestResult("error");
      setTestError("Enter the Gateway base URL.");
      return;
    }
    setTestLoading(true);
    setTestResult(null);
    setTestError(null);
    try {
      save();
      const base = url.replace(/\/$/, "");
      const token = apiToken.trim();
      const agent = agentId.trim() || DEFAULT_AGENT_ID;

      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      headers["x-openclaw-agent-id"] = agent;

      const result = await invoke<{ status: number; status_text: string; body: string }>(
        "openclaw_request",
        { request: { url: base, headers, body: "" } }
      );

      if (result.status >= 200 && result.status < 300) {
        setTestResult("ok");
      } else if (result.status === 404) {
        setTestError(
          "404 — Gateway responded but the path was not found. Ensure the Gateway is running on this URL."
        );
        setTestResult("error");
      } else if (result.status === 401) {
        setTestError(
          "401 Unauthorized — Enter your Gateway API token above. If auth is enabled, the token is in ~/.openclaw/openclaw.json under gateway.auth.token."
        );
        setTestResult("error");
      } else {
        const short = result.body.length > 80 ? result.body.slice(0, 80) + "…" : result.body;
        setTestError(`${result.status} ${result.status_text}${short ? ` — ${short}` : ""}`);
        setTestResult("error");
      }
    } catch (e) {
      setTestResult("error");
      setTestError(e instanceof Error ? e.message : "Network error");
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div id="openclaw-connection" className="space-y-3 -mt-2">
      <div className="space-y-2 pt-2">
        <Header
          title="OpenClaw connection"
          description="Connect GhostClaw to your OpenClaw Gateway. All AI requests use this endpoint."
        />

        <div className="space-y-1">
          <label className="text-sm font-medium">API Mode</label>
          <div className="grid grid-cols-2 gap-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => handleModeChange(m.id)}
                className={`flex items-start gap-2 p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                  mode === m.id
                    ? "border-primary bg-primary/5"
                    : "border-input/50 hover:border-input"
                }`}
              >
                {m.id === "responses" ? (
                  <ZapIcon className={`h-4 w-4 mt-0.5 shrink-0 ${mode === m.id ? "text-primary" : "text-muted-foreground"}`} />
                ) : (
                  <NetworkIcon className={`h-4 w-4 mt-0.5 shrink-0 ${mode === m.id ? "text-primary" : "text-muted-foreground"}`} />
                )}
                <div>
                  <p className={`text-sm font-medium ${mode === m.id ? "text-primary" : ""}`}>
                    {m.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {m.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {mode === "responses" && (
          <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
            Requires{" "}
            <code className="text-xs bg-muted px-1 rounded">
              gateway.http.endpoints.responses.enabled: true
            </code>{" "}
            in your OpenClaw config. Follow-up messages in the same session are significantly faster.
          </p>
        )}
        {mode === "completions" && (
          <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
            Requires{" "}
            <code className="text-xs bg-muted px-1 rounded">
              gateway.http.endpoints.chatCompletions.enabled: true
            </code>{" "}
            in your OpenClaw config. Each request is stateless.
          </p>
        )}

        <div className="space-y-1">
          <label className="text-sm font-medium">Base URL (required)</label>
          <Input
            type="url"
            placeholder="http://127.0.0.1:18789"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={save}
            className="h-11 border-1 border-input/50"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">API token (optional)</label>
          <Input
            type="password"
            placeholder="Leave empty if Gateway has no auth"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            onBlur={save}
            className="h-11 border-1 border-input/50"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Agent ID (optional)</label>
          <Input
            type="text"
            placeholder="main"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            onBlur={save}
            className="h-11 border-1 border-input/50"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={testConnection}
            disabled={testLoading || !baseUrl.trim()}
          >
            {testLoading ? (
              <LoaderIcon className="h-4 w-4 animate-spin" />
            ) : (
              <ServerIcon className="h-4 w-4" />
            )}
            <span className="ml-2">Test connection</span>
          </Button>
          {testResult === "ok" && (
            <span className="text-sm text-green-600 dark:text-green-400">
              Connection successful
            </span>
          )}
          {testResult === "error" && (
            <div className="text-sm text-red-600 dark:text-red-400">
              Connection failed
              {testError && (
                <span className="block mt-1 font-normal text-muted-foreground max-w-md">
                  {testError}
                </span>
              )}
            </div>
          )}
          {saved && (
            <span className="text-sm text-muted-foreground">Saved</span>
          )}
        </div>
      </div>
    </div>
  );
};
