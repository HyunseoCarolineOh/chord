/**
 * Sidecar bridge — Tauri 코어가 spawn한 Node 프로세스와 JSONL로 통신.
 *
 * 대표 사용:
 *   const result = await runQuery(payload, {
 *     onAssistantText: (delta) => ...,
 *     onToolUse: (tu) => ...,
 *   });
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type SidecarLine =
  | { id: string; event: "ready"; data: { pid: number; claudeCli: string | null } }
  | { id: string; event: "started" }
  | { id: string; event: "message"; data: SDKMessage }
  | { id: string; event: "done"; data: SDKResult | null }
  | { id: string; event: "cancelled" }
  | { id: string; event: "pong"; data: { pid: number; ts: number } }
  | { id: string; event: "error"; data: { message: string; code?: string } };

// SDK 메시지를 자세히 다 타이핑하지 않고 필요한 부분만.
type SDKMessage =
  | {
      type: "assistant";
      message: { content: SDKContentBlock[] };
      session_id?: string;
    }
  | { type: "user"; [k: string]: unknown }
  | { type: "system"; [k: string]: unknown }
  | { type: "result"; [k: string]: unknown }
  | { type: string; [k: string]: unknown };

type SDKContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: unknown }
  | { type: string; [k: string]: unknown };

type SDKResult = { type: "result"; [k: string]: unknown };

type RunPayload = {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  cwd?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  maxTurns?: number;
  mcpServers?: Record<string, unknown>;
  allowDangerouslySkipPermissions?: boolean;
};

type RunCallbacks = {
  onAssistantText?: (delta: string) => void;
  onToolUse?: (tu: { id: string; name: string; input: unknown }) => void;
  onToolResult?: (tr: { toolUseId: string; content: unknown }) => void;
  onSystem?: (m: SDKMessage) => void;
};

// 단일 글로벌 listen 구독 — 모든 라인을 id로 라우팅.
type Pending = {
  cb: RunCallbacks;
  resolve: (final: { fullText: string; result: SDKResult | null }) => void;
  reject: (e: Error) => void;
  fullText: string;
};

const pending = new Map<string, Pending>();
let initialized = false;
let unlistenLine: UnlistenFn | null = null;
let unlistenStderr: UnlistenFn | null = null;

async function ensureInit(): Promise<void> {
  if (initialized) return;
  initialized = true;

  unlistenLine = await listen<string>("sidecar:line", (e) => {
    let parsed: SidecarLine;
    try {
      parsed = JSON.parse(e.payload);
    } catch {
      return;
    }
    const p = pending.get(parsed.id);
    if (!p) return;

    switch (parsed.event) {
      case "started":
        break;
      case "message": {
        const msg = parsed.data as { type: string; message?: { content?: SDKContentBlock[] } };
        if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
          for (const block of msg.message.content) {
            if (block.type === "text" && typeof (block as { text: string }).text === "string") {
              const t = (block as { text: string }).text;
              p.fullText += t;
              p.cb.onAssistantText?.(t);
            } else if (block.type === "tool_use") {
              const tu = block as { id: string; name: string; input: unknown };
              p.cb.onToolUse?.({ id: tu.id, name: tu.name, input: tu.input });
            } else if (block.type === "tool_result") {
              const tr = block as { tool_use_id: string; content: unknown };
              p.cb.onToolResult?.({ toolUseId: tr.tool_use_id, content: tr.content });
            }
          }
        } else if (msg.type === "system") {
          p.cb.onSystem?.(msg as SDKMessage);
        }
        break;
      }
      case "done":
        pending.delete(parsed.id);
        p.resolve({ fullText: p.fullText, result: parsed.data });
        break;
      case "error":
        pending.delete(parsed.id);
        p.reject(new Error(parsed.data.message));
        break;
      case "cancelled":
        pending.delete(parsed.id);
        p.reject(new Error("cancelled"));
        break;
    }
  });

  unlistenStderr = await listen<string>("sidecar:stderr", (e) => {
    // 개발 중에만 콘솔로
    console.warn("[sidecar:stderr]", e.payload);
  });
}

export async function runQuery(
  payload: RunPayload,
  cb: RunCallbacks = {},
): Promise<{ id: string; fullText: string; result: SDKResult | null }> {
  await ensureInit();
  const id = crypto.randomUUID();
  const promise = new Promise<{ fullText: string; result: SDKResult | null }>((resolve, reject) => {
    pending.set(id, { cb, resolve, reject, fullText: "" });
  });
  await invoke("sidecar_send", {
    line: JSON.stringify({ id, type: "query", payload }),
  });
  const final = await promise;
  return { id, ...final };
}

export async function cancel(id: string): Promise<void> {
  await invoke("sidecar_send", {
    line: JSON.stringify({ id, type: "cancel" }),
  });
}

export async function ping(): Promise<void> {
  await ensureInit();
  const id = crypto.randomUUID();
  await invoke("sidecar_send", {
    line: JSON.stringify({ id, type: "ping" }),
  });
}

// HMR 시 listener 누수 방지
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unlistenLine?.();
    unlistenStderr?.();
    initialized = false;
  });
}
