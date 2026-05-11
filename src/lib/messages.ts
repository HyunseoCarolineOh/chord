import { supabase } from "./supabase";
import type { Message, MessageRole } from "../types";

type InsertOpts = {
  sessionId: string;
  role: MessageRole;
  content: string;
  agentName?: string;
};

export async function insertMessage(opts: InsertOpts): Promise<Message> {
  const { data, error } = await supabase
    .from("chord_messages")
    .insert({
      session_id: opts.sessionId,
      role: opts.role,
      content: opts.content,
      agent_name: opts.agentName ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Message;
}

export async function updateMessage(
  id: string,
  patch: { content?: string; tool_calls?: unknown[] },
): Promise<void> {
  const { error } = await supabase.from("chord_messages").update(patch).eq("id", id);
  if (error) throw error;
}

export async function softDeleteMessage(id: string): Promise<void> {
  const { error } = await supabase
    .from("chord_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function editMessageContent(id: string, content: string): Promise<void> {
  const { error } = await supabase
    .from("chord_messages")
    .update({ content, edited_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// 스레드 안에서 user 메시지를 편집했을 때, 같은 thread의 created_at > base 인 메시지를 일괄 soft-delete.
// 반환: 영향받은 row 수.
export async function softDeleteThreadMessagesAfter(
  threadId: string,
  afterIso: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("chord_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("thread_id", threadId)
    .gt("created_at", afterIso)
    .is("deleted_at", null)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}
