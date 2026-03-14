import { useState, useEffect, useCallback } from "react";
import {
  SaveIcon,
  RefreshCwIcon,
  LoaderIcon,
  RotateCcwIcon,
  CheckCircleIcon,
} from "lucide-react";
import { Button, Header } from "@/components";
import { invoke } from "@tauri-apps/api/core";
import { Input } from "@/components";

interface ConfigData {
  [key: string]: unknown;
}

function getNestedValue(obj: ConfigData, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

function setNestedValue(obj: ConfigData, path: string, value: unknown): ConfigData {
  const clone = JSON.parse(JSON.stringify(obj));
  const keys = path.split(".");
  let cur: Record<string, unknown> = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] === undefined || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
  return clone;
}

interface ConfigField {
  path: string;
  label: string;
  description: string;
  type: "text" | "boolean" | "number" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
}

const CONFIG_FIELDS: ConfigField[] = [
  {
    path: "agents.defaults.model.primary",
    label: "Primary model",
    description: "The default LLM model for the agent (e.g. openai/gpt-4.1-mini for fast responses)",
    type: "text",
    placeholder: "openai/gpt-4.1-mini",
  },
  {
    path: "gateway.mode",
    label: "Gateway mode",
    description: "How the gateway runs: local, cloud, or hybrid",
    type: "select",
    options: [
      { value: "local", label: "Local" },
      { value: "cloud", label: "Cloud" },
      { value: "hybrid", label: "Hybrid" },
    ],
  },
  {
    path: "gateway.auth.mode",
    label: "Auth mode",
    description: "How the gateway authenticates requests",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "token", label: "Token" },
      { value: "password", label: "Password" },
    ],
  },
  {
    path: "gateway.auth.token",
    label: "Auth token",
    description: "The bearer token for gateway authentication",
    type: "text",
    placeholder: "your-gateway-token",
  },
  {
    path: "gateway.http.endpoints.chatCompletions.enabled",
    label: "Chat Completions endpoint",
    description: "Enable the OpenAI-compatible /v1/chat/completions HTTP endpoint",
    type: "boolean",
  },
  {
    path: "agents.defaults.compaction.mode",
    label: "Compaction mode",
    description: "How the agent compacts conversation history",
    type: "select",
    options: [
      { value: "safeguard", label: "Safeguard" },
      { value: "aggressive", label: "Aggressive" },
      { value: "none", label: "None" },
    ],
  },
  {
    path: "agents.defaults.maxConcurrent",
    label: "Max concurrent agents",
    description: "Maximum number of agents that can run simultaneously",
    type: "number",
  },
  {
    path: "agents.defaults.subagents.maxConcurrent",
    label: "Max concurrent subagents",
    description: "Maximum subagents per agent run",
    type: "number",
  },
];

export const ClawConfig = () => {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [rawJson, setRawJson] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [status, setStatus] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    try {
      const raw = await invoke<string>("read_openclaw_config");
      const parsed = JSON.parse(raw);
      setConfig(parsed);
      setRawJson(JSON.stringify(parsed, null, 2));
    } catch (e) {
      setStatus({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const saveConfig = async (data?: string) => {
    setSaving(true);
    setStatus(null);
    try {
      const toSave = data ?? (showRaw ? rawJson : JSON.stringify(config, null, 2));
      JSON.parse(toSave);
      await invoke("write_openclaw_config", { contents: toSave });
      setStatus({ type: "ok", text: "Config saved" });
      if (!data) await loadConfig();
    } catch (e) {
      setStatus({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const restartGateway = async () => {
    setRestarting(true);
    setStatus(null);
    try {
      const msg = await invoke<string>("restart_openclaw_gateway");
      setStatus({ type: "ok", text: msg || "Gateway restart triggered" });
    } catch (e) {
      setStatus({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setRestarting(false);
    }
  };

  const updateField = (path: string, value: unknown) => {
    if (!config) return;
    const updated = setNestedValue(config, path, value);
    setConfig(updated);
    setRawJson(JSON.stringify(updated, null, 2));
  };

  const renderField = (field: ConfigField) => {
    if (!config) return null;
    const value = getNestedValue(config, field.path);

    if (field.type === "boolean") {
      const checked = value === true;
      return (
        <div key={field.path} className="flex items-center justify-between py-2 border-b border-input/30 last:border-0">
          <div className="space-y-0.5 flex-1 mr-4">
            <p className="text-sm font-medium">{field.label}</p>
            <p className="text-xs text-muted-foreground">{field.description}</p>
          </div>
          <button
            onClick={() => updateField(field.path, !checked)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              checked ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0 transition-transform ${
                checked ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      );
    }

    if (field.type === "select" && field.options) {
      return (
        <div key={field.path} className="space-y-1 py-2 border-b border-input/30 last:border-0">
          <p className="text-sm font-medium">{field.label}</p>
          <p className="text-xs text-muted-foreground">{field.description}</p>
          <div className="flex gap-1.5 mt-1">
            {field.options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => updateField(field.path, opt.value)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  String(value) === opt.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted border-input/50 hover:bg-muted/80"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div key={field.path} className="space-y-1 py-2 border-b border-input/30 last:border-0">
        <p className="text-sm font-medium">{field.label}</p>
        <p className="text-xs text-muted-foreground">{field.description}</p>
        <Input
          type={field.type === "number" ? "number" : "text"}
          placeholder={field.placeholder}
          value={value != null ? String(value) : ""}
          onChange={(e) => {
            const v = field.type === "number" ? Number(e.target.value) : e.target.value;
            updateField(field.path, v);
          }}
          className="h-9 border-1 border-input/50 text-sm"
        />
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoaderIcon className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3 -mt-2">
      <div className="space-y-2 pt-2">
        <Header
          title="OpenClaw config"
          description="Edit your local OpenClaw Gateway config (~/.openclaw/openclaw.json). Changes are saved to disk."
        />

        {!showRaw && config && (
          <div className="space-y-0">
            {CONFIG_FIELDS.map(renderField)}
          </div>
        )}

        {showRaw && (
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            className="w-full h-80 rounded-lg border border-input/50 bg-muted/30 p-3 font-mono text-xs resize-y focus:outline-none focus:ring-1 focus:ring-primary"
            spellCheck={false}
          />
        )}

        <div className="flex items-center gap-2 flex-wrap pt-1">
          <Button variant="outline" size="sm" onClick={() => setShowRaw(!showRaw)}>
            {showRaw ? "Form view" : "Raw JSON"}
          </Button>
          <Button
            size="sm"
            onClick={() => saveConfig()}
            disabled={saving}
          >
            {saving ? <LoaderIcon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
            <span className="ml-1.5">Save config</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={restartGateway}
            disabled={restarting}
          >
            {restarting ? <LoaderIcon className="h-4 w-4 animate-spin" /> : <RotateCcwIcon className="h-4 w-4" />}
            <span className="ml-1.5">Restart Gateway</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={loadConfig}>
            <RefreshCwIcon className="h-4 w-4" />
            <span className="ml-1.5">Reload</span>
          </Button>
        </div>

        {status && (
          <div className={`text-sm flex items-center gap-1.5 ${status.type === "ok" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {status.type === "ok" && <CheckCircleIcon className="h-4 w-4" />}
            {status.text}
          </div>
        )}
      </div>
    </div>
  );
};
