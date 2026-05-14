// 선택한 메시지를 같은 채널 안 기존 thread로 포크(=append).
// 새 thread는 만들지 않는다. 원본 메시지는 그대로 유지하고, 대상 thread에
// created_at 순으로 INSERT한다. tool_calls·agent_name·role 모두 보존.
import { supabase } from "./supabase";
import type { Message, Thread } from "../types";

export type ForkInput = {
  /** 복사 대상 message id 목록. created_at 순으로 정렬돼 INSERT됨 */
  messageIds: string[];
  /** 포크 대상 thread id (같은 채널 안 다른 스레드) */
  targetThreadId: string;
};

export type ForkResult = {
  thread: Thread;
  insertedCount: number;
};

export async function forkMessages(input: ForkInput): Promise<ForkResult> {
  if (input.messageIds.length === 0) {
    throw new Error("선택된 메시지가 없습니다.");
  }

  // 1. 대상 thread 확보 (session_id 포함)
  const { data: tRow, error: tErr } = await supabase
    .from("chord_threads")
    .select("*")
    .eq("id", input.targetThreadId)
    .maybeSingle();
  if (tErr || !tRow) {
    throw new Error(tErr?.message ?? "대상 스레드를 찾을 수 없습니다.");
  }
  const thread = tRow as Thread;

  // 2. 원본 메시지 fetch (created_at 순)
  const { data: srcRows, error: srcErr } = await supabase
    .from("chord_messages")
    .select("*")
    .in("id", input.messageIds)
    .order("created_at", { ascending: true });
  if (srcErr) throw new Error(srcErr.message);
  const sources = (srcRows ?? []) as Message[];
  if (sources.length === 0) throw new Error("원본 메시지를 찾을 수 없습니다.");

  // 3. 메시지 INSERT — 순서 보장 위해 순차 INSERT (created_at은 DB default now() 사용)
  let insertedCount = 0;
  for (const m of sources) {
    const { error: insErr } = await supabase.from("chord_messages").insert({
      session_id: thread.session_id,
      thread_id: thread.id,
      role: m.role,
      agent_name: m.agent_name,
      content: m.content,
      tool_calls: m.tool_calls ?? [],
      source: "fork",
    });
    if (insErr) {
      throw new Error(`메시지 ${insertedCount + 1}/${sources.length} INSERT 실패: ${insErr.message}`);
    }
    insertedCount += 1;
  }

  return { thread, insertedCount };
}
