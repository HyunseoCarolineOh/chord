// 선택한 메시지를 새 thread로 포크.
// 같은 채널이든 다른 채널이든 대상 채널의 active session(없으면 생성)에 새 thread를 만들고,
// 선택 메시지를 created_at 순으로 그대로 INSERT한다. tool_calls·agent_name·role 모두 보존.
import { supabase } from "./supabase";
import type { Message, Session, Thread } from "../types";

export type ForkInput = {
  /** 복사 대상 message id 목록. created_at 순으로 정렬돼 INSERT됨 */
  messageIds: string[];
  /** 포크 대상 channel id */
  targetChannelId: string;
  /** 새 thread 이름 (제목) */
  threadName: string;
};

export type ForkResult = {
  thread: Thread;
  session: Session;
  insertedCount: number;
};

export async function forkMessages(input: ForkInput): Promise<ForkResult> {
  if (input.messageIds.length === 0) {
    throw new Error("선택된 메시지가 없습니다.");
  }

  // 1. 대상 채널 확보
  const { data: channelRow, error: chErr } = await supabase
    .from("chord_channels")
    .select("id, active_session_id, name")
    .eq("id", input.targetChannelId)
    .maybeSingle();
  if (chErr || !channelRow) {
    throw new Error(chErr?.message ?? "대상 채널을 찾을 수 없습니다.");
  }

  // 2. active session 확보 (없으면 fork 세션 자동 생성)
  let session: Session;
  if (channelRow.active_session_id) {
    const { data: s, error: sErr } = await supabase
      .from("chord_sessions")
      .select("*")
      .eq("id", channelRow.active_session_id)
      .maybeSingle();
    if (sErr || !s) {
      throw new Error(sErr?.message ?? "active session을 찾을 수 없습니다.");
    }
    session = s as Session;
  } else {
    const sessionName = `forked-${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const { data: newSess, error: nsErr } = await supabase
      .from("chord_sessions")
      .insert({
        channel_id: channelRow.id,
        name: sessionName,
        status: "active",
      })
      .select()
      .single();
    if (nsErr || !newSess) {
      throw new Error(nsErr?.message ?? "fork 세션 생성 실패");
    }
    session = newSess as Session;
    // 채널 active_session_id 갱신
    await supabase
      .from("chord_channels")
      .update({ active_session_id: session.id })
      .eq("id", channelRow.id);
  }

  // 3. 원본 메시지 fetch (created_at 순)
  const { data: srcRows, error: srcErr } = await supabase
    .from("chord_messages")
    .select("*")
    .in("id", input.messageIds)
    .order("created_at", { ascending: true });
  if (srcErr) throw new Error(srcErr.message);
  const sources = (srcRows ?? []) as Message[];
  if (sources.length === 0) throw new Error("원본 메시지를 찾을 수 없습니다.");

  // 4. 새 thread 생성
  const { data: tRow, error: tErr } = await supabase
    .from("chord_threads")
    .insert({
      session_id: session.id,
      parent_message_id: null,
      title: input.threadName.slice(0, 200),
      name: input.threadName.slice(0, 200),
    })
    .select()
    .single();
  if (tErr || !tRow) throw new Error(tErr?.message ?? "thread 생성 실패");
  const thread = tRow as Thread;

  // 5. 메시지 INSERT — 순서 보장 위해 순차 INSERT (created_at은 DB default now() 사용)
  let insertedCount = 0;
  for (const m of sources) {
    const { error: insErr } = await supabase.from("chord_messages").insert({
      session_id: session.id,
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

  return { thread, session, insertedCount };
}
