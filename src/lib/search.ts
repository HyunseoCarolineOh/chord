// 검색 — 메시지·세션 trigram-ILIKE.
import { supabase } from "./supabase";
import type { Message, Session, Channel } from "../types";

export type MessageHit = Message & {
  session_name?: string;
  channel_name?: string;
  channel_id?: string;
};

export async function searchMessages(opts: {
  workspaceId: string;
  query: string;
  agent?: string;
  channelId?: string;
  limit?: number;
}): Promise<MessageHit[]> {
  const q = opts.query.trim();
  if (!q) return [];
  const limit = opts.limit ?? 50;

  // session → channel join을 위해 nested select
  let req = supabase
    .from("chord_messages")
    .select(
      "*, chord_sessions!inner(name, channel_id, chord_channels!inner(name, workspace_id))",
    )
    .ilike("content", `%${q}%`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.agent) req = req.eq("agent_name", opts.agent);

  const { data, error } = await req;
  if (error) throw error;

  type Row = Message & {
    chord_sessions: {
      name: string;
      channel_id: string;
      chord_channels: { name: string; workspace_id: string };
    };
  };
  const rows = (data ?? []) as Row[];
  return rows
    .filter((r) => r.chord_sessions.chord_channels.workspace_id === opts.workspaceId)
    .filter((r) => !opts.channelId || r.chord_sessions.channel_id === opts.channelId)
    .map((r) => {
      const { chord_sessions, ...m } = r;
      return {
        ...(m as Message),
        session_name: chord_sessions.name,
        channel_id: chord_sessions.channel_id,
        channel_name: chord_sessions.chord_channels.name,
      };
    });
}

export async function searchSessions(workspaceId: string, query: string): Promise<(Session & { channel_name: string })[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from("chord_sessions")
    .select("*, chord_channels!inner(name, workspace_id)")
    .ilike("name", `%${q}%`)
    .order("started_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  type Row = Session & { chord_channels: { name: string; workspace_id: string } };
  return ((data ?? []) as Row[])
    .filter((r) => r.chord_channels.workspace_id === workspaceId)
    .map((r) => ({ ...(r as Session), channel_name: r.chord_channels.name }));
}

export async function listChannelsForJump(workspaceId: string): Promise<Channel[]> {
  const { data, error } = await supabase
    .from("chord_channels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Channel[];
}
