/**
 * 슬래시 커맨드 — Phase 2 확장:
 *   /session start <name> | end | reopen <name> | list
 *   /channel create <name> [cwd]
 *   /channel cwd <path>
 *   /channel allow <Tool1>,<Tool2>,...
 *   /channel agents add <name> | remove <name>
 *   /agent list
 *   /workspace create <name> <path>
 *   /workspace list
 *   /thread <title>           ← 입력창 위 hover 메시지 선택 시
 */

import { supabase } from "./supabase";
import type { Session, Channel, Workspace } from "../types";

export type SlashResult =
  | { ok: true; message: string; channelChanged?: boolean; workspaceChanged?: boolean }
  | { ok: false; message: string };

export async function runSlash(
  channel: Channel,
  workspace: Workspace,
  command: string,
  args: string[],
): Promise<SlashResult> {
  switch (command) {
    case "session":
      return runSession(channel, args);
    case "channel":
      return runChannel(workspace, channel, args);
    case "agent":
      return runAgent(args);
    case "workspace":
      return runWorkspace(args);
    default:
      return { ok: false, message: `unknown command: /${command}` };
  }
}

// ===== /session =====
async function runSession(channel: Channel, args: string[]): Promise<SlashResult> {
  const sub = args[0];
  switch (sub) {
    case "start":
      return startSession(channel, args.slice(1).join(" "));
    case "end":
      return endSession(channel);
    case "reopen":
      return reopenSession(channel, args.slice(1).join(" "));
    case "list":
      return listSessions(channel);
    case "archive":
      return archiveSession(channel);
    default:
      return { ok: false, message: "usage: /session [start <name> | end | reopen <name> | list | archive]" };
  }
}

async function archiveSession(channel: Channel): Promise<SlashResult> {
  if (!channel.active_session_id) return { ok: false, message: "active session이 없습니다." };
  const { error } = await supabase
    .from("chord_sessions")
    .update({ archived: true, status: "closed", ended_at: new Date().toISOString() })
    .eq("id", channel.active_session_id);
  if (error) return { ok: false, message: error.message };
  await supabase.from("chord_channels").update({ active_session_id: null }).eq("id", channel.id);
  return { ok: true, message: "session archived", channelChanged: true };
}

async function startSession(channel: Channel, name: string): Promise<SlashResult> {
  if (!name.trim()) return { ok: false, message: "세션 이름이 필요합니다: /session start <name>" };

  if (channel.active_session_id) {
    const existing = await fetchSession(channel.active_session_id);
    if (existing && existing.status === "active") {
      return {
        ok: false,
        message: `이미 active session이 있습니다: "${existing.name}". 먼저 /session end 하세요.`,
      };
    }
  }

  const { data: session, error: sErr } = await supabase
    .from("chord_sessions")
    .insert({ channel_id: channel.id, name: name.trim(), status: "active" })
    .select()
    .single();
  if (sErr) return { ok: false, message: `세션 생성 실패: ${sErr.message}` };

  const { error: cErr } = await supabase
    .from("chord_channels")
    .update({ active_session_id: (session as Session).id })
    .eq("id", channel.id);
  if (cErr) return { ok: false, message: `채널 갱신 실패: ${cErr.message}` };

  return { ok: true, message: `▶ session "${(session as Session).name}" started`, channelChanged: true };
}

async function endSession(channel: Channel): Promise<SlashResult> {
  if (!channel.active_session_id) return { ok: false, message: "active session이 없습니다." };

  const { data: session, error: sErr } = await supabase
    .from("chord_sessions")
    .update({ status: "closed", ended_at: new Date().toISOString() })
    .eq("id", channel.active_session_id)
    .select()
    .single();
  if (sErr) return { ok: false, message: `세션 종료 실패: ${sErr.message}` };

  const { error: cErr } = await supabase
    .from("chord_channels")
    .update({ active_session_id: null })
    .eq("id", channel.id);
  if (cErr) return { ok: false, message: `채널 갱신 실패: ${cErr.message}` };

  return { ok: true, message: `■ session "${(session as Session).name}" closed`, channelChanged: true };
}

async function reopenSession(channel: Channel, query: string): Promise<SlashResult> {
  if (!query.trim()) return { ok: false, message: "세션 이름 또는 id 필요: /session reopen <name>" };
  if (channel.active_session_id) {
    return { ok: false, message: "다른 active session이 있습니다. 먼저 /session end 하세요." };
  }

  let { data: session } = await supabase
    .from("chord_sessions")
    .select("*")
    .eq("channel_id", channel.id)
    .eq("status", "closed")
    .eq("name", query.trim())
    .order("ended_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) {
    const byId = await supabase
      .from("chord_sessions")
      .select("*")
      .eq("id", query.trim())
      .maybeSingle();
    if (byId.data) session = byId.data;
  }

  if (!session) return { ok: false, message: `closed session을 찾을 수 없습니다: "${query}"` };

  const { error: uErr } = await supabase
    .from("chord_sessions")
    .update({ status: "active", ended_at: null })
    .eq("id", (session as Session).id);
  if (uErr) return { ok: false, message: `세션 재활성 실패: ${uErr.message}` };

  const { error: cErr } = await supabase
    .from("chord_channels")
    .update({ active_session_id: (session as Session).id })
    .eq("id", channel.id);
  if (cErr) return { ok: false, message: `채널 갱신 실패: ${cErr.message}` };

  return {
    ok: true,
    message: `▶ session "${(session as Session).name}" reopened`,
    channelChanged: true,
  };
}

async function listSessions(channel: Channel): Promise<SlashResult> {
  const { data, error } = await supabase
    .from("chord_sessions")
    .select("name,status,started_at,ended_at")
    .eq("channel_id", channel.id)
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: true, message: "(no sessions yet)" };
  const lines = data.map(
    (s: { name: string; status: string; started_at: string }) =>
      `${s.status === "active" ? "▶" : "·"} ${s.name}  (${s.status}, ${new Date(s.started_at).toLocaleString()})`,
  );
  return { ok: true, message: lines.join("\n") };
}

async function fetchSession(id: string): Promise<Session | null> {
  const { data } = await supabase.from("chord_sessions").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as Session | null;
}

// ===== /channel =====
async function runChannel(workspace: Workspace, channel: Channel, args: string[]): Promise<SlashResult> {
  const sub = args[0];
  switch (sub) {
    case "create": {
      const name = args[1];
      if (!name) return { ok: false, message: "/channel create <name> [cwd]" };
      const cwd = args[2];
      const { data, error } = await supabase
        .from("chord_channels")
        .insert({
          workspace_id: workspace.id,
          name,
          cwd: cwd ?? workspace.root_path,
          allowed_tools: ["Read", "Edit", "Write", "Grep", "Glob", "Bash"],
          agent_ids: [],
        })
        .select()
        .single();
      if (error) return { ok: false, message: error.message };
      return { ok: true, message: `# ${(data as Channel).name} created`, workspaceChanged: true };
    }
    case "cwd": {
      const cwd = args.slice(1).join(" ");
      if (!cwd) return { ok: false, message: "/channel cwd <path>" };
      const { error } = await supabase
        .from("chord_channels")
        .update({ cwd })
        .eq("id", channel.id);
      if (error) return { ok: false, message: error.message };
      return { ok: true, message: `cwd → ${cwd}`, workspaceChanged: true };
    }
    case "allow": {
      const tools = (args[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (tools.length === 0) return { ok: false, message: "/channel allow Tool1,Tool2,..." };
      const { error } = await supabase
        .from("chord_channels")
        .update({ allowed_tools: tools })
        .eq("id", channel.id);
      if (error) return { ok: false, message: error.message };
      return { ok: true, message: `allowed_tools = [${tools.join(", ")}]`, workspaceChanged: true };
    }
    case "agents": {
      const op = args[1];
      const name = args[2];
      if (!op || !name) return { ok: false, message: "/channel agents [add|remove] <name>" };
      const next =
        op === "add"
          ? Array.from(new Set([...channel.agent_ids, name]))
          : channel.agent_ids.filter((a) => a !== name);
      const { error } = await supabase
        .from("chord_channels")
        .update({ agent_ids: next })
        .eq("id", channel.id);
      if (error) return { ok: false, message: error.message };
      return { ok: true, message: `agents = [${next.map((a) => "@" + a).join(", ")}]`, workspaceChanged: true };
    }
    case "archive": {
      const { error } = await supabase
        .from("chord_channels")
        .update({ archived: !channel.archived })
        .eq("id", channel.id);
      if (error) return { ok: false, message: error.message };
      return {
        ok: true,
        message: channel.archived ? "channel unarchived" : "channel archived",
        workspaceChanged: true,
      };
    }
    case "mcp": {
      const op = args[1];
      if (op === "add") {
        // /channel mcp add <name> stdio <command> [args...]
        // /channel mcp add <name> http <url>
        const name = args[2];
        const type = args[3];
        if (!name || (type !== "stdio" && type !== "http" && type !== "sse")) {
          return { ok: false, message: "/channel mcp add <name> [stdio|http|sse] <command|url>" };
        }
        const cfg: any = { name, type };
        if (type === "stdio") {
          cfg.command = args[4];
          cfg.args = args.slice(5);
        } else {
          cfg.url = args[4];
        }
        const next = [...channel.mcp_servers.filter((s) => s.name !== name), cfg];
        const { error } = await supabase
          .from("chord_channels")
          .update({ mcp_servers: next })
          .eq("id", channel.id);
        if (error) return { ok: false, message: error.message };
        return { ok: true, message: `mcp server "${name}" added`, workspaceChanged: true };
      }
      if (op === "remove") {
        const name = args[2];
        const next = channel.mcp_servers.filter((s) => s.name !== name);
        const { error } = await supabase
          .from("chord_channels")
          .update({ mcp_servers: next })
          .eq("id", channel.id);
        if (error) return { ok: false, message: error.message };
        return { ok: true, message: `mcp server "${name}" removed`, workspaceChanged: true };
      }
      if (op === "list" || !op) {
        if (channel.mcp_servers.length === 0) return { ok: true, message: "(no mcp servers)" };
        return {
          ok: true,
          message: channel.mcp_servers
            .map((s) => `· ${s.name} [${s.type}] ${s.command ?? s.url ?? ""}`)
            .join("\n"),
        };
      }
      return { ok: false, message: "/channel mcp [add <name> ... | remove <name> | list]" };
    }
    default:
      return {
        ok: false,
        message:
          "usage: /channel [create <name> [cwd] | cwd <path> | allow Tool1,... | agents add|remove <name> | archive | mcp add|remove|list]",
      };
  }
}

// ===== /agent =====
async function runAgent(args: string[]): Promise<SlashResult> {
  if (args[0] === "list" || !args[0]) {
    return {
      ok: true,
      message: "에이전트는 .chord/agents/<name>.md 파일로 정의합니다 (frontmatter: name, description, model, tools).",
    };
  }
  return { ok: false, message: "usage: /agent list" };
}

// ===== /workspace =====
async function runWorkspace(args: string[]): Promise<SlashResult> {
  const sub = args[0];
  switch (sub) {
    case "create": {
      const name = args[1];
      const path = args.slice(2).join(" ");
      if (!name || !path) return { ok: false, message: "/workspace create <name> <absolute-path>" };
      const { data, error } = await supabase
        .from("chord_workspaces")
        .insert({ name, root_path: path })
        .select()
        .single();
      if (error) return { ok: false, message: error.message };
      return { ok: true, message: `workspace "${(data as Workspace).name}" created`, workspaceChanged: true };
    }
    case "list": {
      const { data, error } = await supabase
        .from("chord_workspaces")
        .select("name,root_path")
        .order("created_at", { ascending: true });
      if (error) return { ok: false, message: error.message };
      if (!data || data.length === 0) return { ok: true, message: "(no workspaces)" };
      const lines = data.map((w: { name: string; root_path: string }) => `· ${w.name} — ${w.root_path}`);
      return { ok: true, message: lines.join("\n") };
    }
    default:
      return { ok: false, message: "usage: /workspace [create <name> <path> | list]" };
  }
}
