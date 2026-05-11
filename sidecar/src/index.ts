/**
 * chord sidecar — Tauri 코어가 stdin/stdout JSONL로 호출하는 Node 프로세스.
 *
 * Protocol (line-delimited JSON):
 *   IN  {"id":"<uuid>","type":"query","payload":{...}}
 *   IN  {"id":"<uuid>","type":"cancel"}
 *   IN  {"id":"<uuid>","type":"ping"}
 *   OUT {"id":"<uuid>","event":"started"}
 *   OUT {"id":"<uuid>","event":"message","data":<SDKMessage>}
 *   OUT {"id":"<uuid>","event":"done","data":<SDKResultMessage>}
 *   OUT {"id":"<uuid>","event":"error","data":{"message":"..."}}
 *
 * 의도된 단순화:
 * - 컨텍스트 조립(active session 메시지 누적, agent.md 합성)은 chord 코어 책임.
 *   sidecar는 받은 prompt + options를 그대로 SDK에 전달하고 스트림만 중계.
 */

import { createInterface } from "node:readline";
import { stdin, stdout, stderr } from "node:process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { query, AbortError } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

/**
 * 시스템 PATH에서 claude CLI를 찾는다. 발견 시 SDK가 사용자 OAuth 인증을
 * 가진 그 CLI를 spawn하므로 ANTHROPIC_API_KEY가 필요 없다.
 *
 * 우선순위:
 *   1. CLAUDE_CLI_PATH 환경변수
 *   2. PATH 검색 (Windows: claude.exe/.cmd, POSIX: claude)
 *   3. 못 찾으면 undefined → SDK 자체 번들 CLI 사용 (이 경우 API 키 필요)
 */
function resolveClaudeCli(): string | undefined {
  if (process.env.CLAUDE_CLI_PATH && existsSync(process.env.CLAUDE_CLI_PATH)) {
    return process.env.CLAUDE_CLI_PATH;
  }
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, "claude" + ext);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const CLAUDE_CLI = resolveClaudeCli();

type RequestId = string;

type IncomingRequest =
  | { id: RequestId; type: "query"; payload: QueryPayload }
  | { id: RequestId; type: "cancel" }
  | { id: RequestId; type: "ping" };

type QueryPayload = {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  cwd?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: Options["permissionMode"];
  maxTurns?: number;
  mcpServers?: Record<string, unknown>;
  allowDangerouslySkipPermissions?: boolean;
};

const activeQueries = new Map<RequestId, AbortController>();

function send(payload: Record<string, unknown>): void {
  stdout.write(JSON.stringify(payload) + "\n");
}

function logErr(...args: unknown[]): void {
  stderr.write(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n");
}

async function handleQuery(id: RequestId, payload: QueryPayload): Promise<void> {
  const ac = new AbortController();
  activeQueries.set(id, ac);
  send({ id, event: "started" });

  try {
    const options: Options = {
      abortController: ac,
      cwd: payload.cwd,
      model: payload.model,
      systemPrompt: payload.systemPrompt
        ? { type: "preset", preset: "claude_code", append: payload.systemPrompt }
        : undefined,
      allowedTools: payload.allowedTools,
      disallowedTools: payload.disallowedTools,
      permissionMode: payload.permissionMode ?? "default",
      allowDangerouslySkipPermissions: payload.allowDangerouslySkipPermissions,
      maxTurns: payload.maxTurns,
      pathToClaudeCodeExecutable: CLAUDE_CLI,
      mcpServers: payload.mcpServers as Options["mcpServers"],
      // ~/.claude/skills, ~/.claude/agents, ~/.claude/CLAUDE.md를 인식하기 위해 'user' source 활성.
      settingSources: ["user"],
    };

    const stream = query({ prompt: payload.prompt, options });

    for await (const message of stream) {
      send({ id, event: "message", data: message });
      if (message.type === "result") {
        send({ id, event: "done", data: message });
        return;
      }
    }
    // 스트림이 result 없이 끝난 경우
    send({ id, event: "done", data: null });
  } catch (err) {
    if (err instanceof AbortError || (err as Error)?.name === "AbortError") {
      send({ id, event: "error", data: { message: "aborted", code: "aborted" } });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    send({ id, event: "error", data: { message: msg } });
  } finally {
    activeQueries.delete(id);
  }
}

function handleCancel(id: RequestId): void {
  const ac = activeQueries.get(id);
  if (ac) {
    ac.abort();
    activeQueries.delete(id);
    send({ id, event: "cancelled" });
  } else {
    send({ id, event: "error", data: { message: "no active query for id", code: "not_found" } });
  }
}

function handlePing(id: RequestId): void {
  send({ id, event: "pong", data: { pid: process.pid, ts: Date.now() } });
}

function dispatch(line: string): void {
  let req: IncomingRequest;
  try {
    req = JSON.parse(line);
  } catch (e) {
    logErr("invalid json on stdin:", line);
    return;
  }

  if (!req || typeof req !== "object" || !("id" in req) || !("type" in req)) {
    logErr("malformed request:", line);
    return;
  }

  switch (req.type) {
    case "query":
      void handleQuery(req.id, req.payload);
      break;
    case "cancel":
      handleCancel(req.id);
      break;
    case "ping":
      handlePing(req.id);
      break;
    default:
      send({ id: (req as IncomingRequest).id, event: "error", data: { message: `unknown type: ${(req as { type: string }).type}` } });
  }
}

function main(): void {
  const rl = createInterface({ input: stdin, terminal: false });
  rl.on("line", dispatch);
  rl.on("close", () => {
    for (const ac of activeQueries.values()) ac.abort();
    process.exit(0);
  });

  // 부팅 알림 — 코어가 sidecar 살아있음 확인용
  send({ id: "__boot__", event: "ready", data: { pid: process.pid, claudeCli: CLAUDE_CLI ?? null } });
}

main();
