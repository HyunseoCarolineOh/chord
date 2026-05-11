import { supabase } from "./supabase";
import type { Thread, Message } from "../types";

export async function listThreads(sessionId: string): Promise<Thread[]> {
  const { data, error } = await supabase
    .from("chord_threads")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Thread[];
}

export async function createThread(
  sessionId: string,
  parentMessageId: string | null,
  title: string,
): Promise<Thread> {
  const { data, error } = await supabase
    .from("chord_threads")
    .insert({ session_id: sessionId, parent_message_id: parentMessageId, title })
    .select()
    .single();
  if (error) throw error;
  return data as Thread;
}

export async function listThreadMessages(threadId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("chord_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Message[];
}

export type ThreadSummary = {
  id: string;
  parent_message_id: string | null;
  name: string | null;
  title: string | null;
  reply_count: number;
  last_at: string | null;
};

/** 세션 안의 thread 목록 + 각 thread의 메시지 count. 채널 본문 chip에 사용. */
export async function listThreadSummaries(sessionId: string): Promise<ThreadSummary[]> {
  const { data: threads, error: tErr } = await supabase
    .from("chord_threads")
    .select("id, parent_message_id, name, title")
    .eq("session_id", sessionId);
  if (tErr) throw tErr;
  const rows = (threads ?? []) as { id: string; parent_message_id: string | null; name: string | null; title: string | null }[];
  if (rows.length === 0) return [];

  const threadIds = rows.map((t) => t.id);
  const { data: msgs, error: mErr } = await supabase
    .from("chord_messages")
    .select("thread_id, created_at")
    .in("thread_id", threadIds);
  if (mErr) throw mErr;

  const counts = new Map<string, number>();
  const latest = new Map<string, string>();
  for (const m of (msgs ?? []) as { thread_id: string; created_at: string }[]) {
    counts.set(m.thread_id, (counts.get(m.thread_id) ?? 0) + 1);
    const prev = latest.get(m.thread_id);
    if (!prev || m.created_at > prev) latest.set(m.thread_id, m.created_at);
  }

  return rows.map((t) => ({
    id: t.id,
    parent_message_id: t.parent_message_id,
    name: t.name,
    title: t.title,
    reply_count: counts.get(t.id) ?? 0,
    last_at: latest.get(t.id) ?? null,
  }));
}
