import { supabase } from "./supabase";
import { deleteAttachments, extractAttachmentPaths } from "./attachments";
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
  // 삭제 전 본문에서 첨부 경로 수집 → soft-delete 후 storage 정리
  const { data: row } = await supabase
    .from("chord_messages")
    .select("content")
    .eq("id", id)
    .single();
  const { error } = await supabase
    .from("chord_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  if (row?.content) {
    const paths = extractAttachmentPaths(row.content);
    if (paths.length > 0) await deleteAttachments(paths);
  }
}

export async function editMessageContent(id: string, content: string): Promise<void> {
  const { error } = await supabase
    .from("chord_messages")
    .update({ content, edited_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** 메시지의 완료 표시 토글. completed=true면 현재 시각 기록, false면 NULL로 되돌림. */
export async function setMessageCompleted(id: string, completed: boolean): Promise<void> {
  const { error } = await supabase
    .from("chord_messages")
    .update({ completed_at: completed ? new Date().toISOString() : null })
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
    .select("id, content");
  if (error) throw error;
  const rows = (data ?? []) as { id: string; content: string }[];
  const paths = rows.flatMap((r) => extractAttachmentPaths(r.content ?? ""));
  if (paths.length > 0) await deleteAttachments(paths);
  return rows.length;
}
