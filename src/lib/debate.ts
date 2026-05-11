/**
 * /debate — 페르소나 간 자동 체이닝 토론.
 *
 * 흐름:
 *   1) /debate <주제> → 새 thread + chord_debates row + 첫 발화자(agent_ids[0])로 dispatchSpeaker
 *   2) 발화 완료 → record_speech → [결론] 마커 / 30발화 안전망 체크 → 다음 발화자 파싱 → 재귀
 *   3) 다음 발화자 없으면 일시정지 (사용자가 thread에서 새 메시지 보내면 재개)
 *
 * discord-claude-bot/debate.py + bot.py의 _dispatch_speaker / _build_thread_prompt 포팅.
 */
import { supabase } from "./supabase";
import { createThread } from "./threads";
import { insertMessage } from "./messages";
import type { Channel, Session, Thread } from "../types";

export const MAX_TOTAL_SPEECHES = 30;
export const CONCLUSION_MARKER = "[결론]";

export type DebateRow = {
  thread_id: string;
  topic: string;
  parent_channel_id: string | null;
  current_speaker: string;
  round_counts: Record<string, number>;
  ended: boolean;
  end_reason: string | null;
  started_at: string;
  ended_at: string | null;
};

export type EndReason =
  | "user_command"
  | "concluded"
  | "max_total_speeches"
  | "no_next_speaker"
  | "config_error";

/** 응답 마지막 줄부터 거슬러 @key 멘션을 찾음. 자기 자신 멘션은 caller가 거른다. */
export function parseNextSpeaker(
  responseText: string,
  availablePersonas: string[],
): string | null {
  if (!responseText) return null;
  const lines = responseText.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    for (const key of availablePersonas) {
      if (line.includes(`@${key}`)) return key;
    }
  }
  return null;
}

/** 응답의 마지막 비공백 줄이 marker로 시작하면 true. 인용·예시 오탐 방지. */
export function hasConclusionMarker(responseText: string, marker: string): boolean {
  if (!responseText || !marker) return false;
  const lines = responseText.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const stripped = lines[i].trim();
    if (!stripped) continue;
    return stripped.startsWith(marker);
  }
  return false;
}

export async function getDebate(threadId: string): Promise<DebateRow | null> {
  const { data } = await supabase
    .from("chord_debates")
    .select("*")
    .eq("thread_id", threadId)
    .maybeSingle();
  return (data ?? null) as DebateRow | null;
}

export async function getActiveDebateForChannel(channelId: string): Promise<DebateRow | null> {
  const { data } = await supabase
    .from("chord_debates")
    .select("*")
    .eq("parent_channel_id", channelId)
    .eq("ended", false)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as DebateRow | null;
}

export async function insertDebate(args: {
  threadId: string;
  topic: string;
  parentChannelId: string;
  firstSpeaker: string;
}): Promise<DebateRow> {
  const { data, error } = await supabase
    .from("chord_debates")
    .insert({
      thread_id: args.threadId,
      topic: args.topic,
      parent_channel_id: args.parentChannelId,
      current_speaker: args.firstSpeaker,
    })
    .select()
    .single();
  if (error) throw error;
  return data as DebateRow;
}

export async function recordSpeech(
  threadId: string,
  personaKey: string,
): Promise<DebateRow | null> {
  const current = await getDebate(threadId);
  if (!current) return null;
  const counts = { ...current.round_counts };
  counts[personaKey] = (counts[personaKey] ?? 0) + 1;
  const { data, error } = await supabase
    .from("chord_debates")
    .update({ round_counts: counts, current_speaker: personaKey })
    .eq("thread_id", threadId)
    .select()
    .single();
  if (error) throw error;
  return data as DebateRow;
}

export async function endDebate(threadId: string, reason: EndReason): Promise<void> {
  await supabase
    .from("chord_debates")
    .update({ ended: true, end_reason: reason, ended_at: new Date().toISOString() })
    .eq("thread_id", threadId);
}

export function totalSpeeches(d: DebateRow): number {
  return Object.values(d.round_counts).reduce((a, b) => a + b, 0);
}

/**
 * 한 페르소나에게 줄 prompt 본문 생성.
 * 채널 본문 transcript는 보지 않고, **이 토론 thread 안 메시지만** 시간순으로 모음.
 */
export async function buildDebatePrompt(args: {
  threadId: string;
  topic: string;
  speakerKey: string;
  available: string[]; // 다른 참여자 키 (자기 제외)
}): Promise<string> {
  const { data } = await supabase
    .from("chord_messages")
    .select("role, agent_name, content")
    .eq("thread_id", args.threadId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(60);
  const rows = (data ?? []) as { role: string; agent_name: string | null; content: string }[];

  const lines: string[] = [];
  for (const m of rows) {
    const text = (m.content ?? "").trim();
    if (!text) continue;
    const speaker =
      m.role === "user"
        ? "사용자"
        : m.role === "agent"
          ? `@${m.agent_name ?? "agent"}`
          : "system";
    lines.push(`[${speaker}]: ${text}`);
  }
  // 50k chars hard cap (앞에서부터 잘라냄)
  const MAX = 50_000;
  let total = lines.reduce((a, l) => a + l.length + 1, 0);
  let truncated = false;
  while (total > MAX && lines.length > 5) {
    const removed = lines.shift();
    total -= (removed?.length ?? 0) + 1;
    truncated = true;
  }
  if (truncated) lines.unshift("[(이전 발언 일부 생략)]");

  const history = lines.join("\n") || "(아직 발언 없음)";
  const mentionList =
    args.available.length > 0
      ? args.available.map((k) => `@${k}`).join(", ")
      : "(다른 참여자 없음)";

  return (
    `=== 토론 주제 ===\n${args.topic}\n\n` +
    `=== 당신 ===\n@${args.speakerKey}\n\n` +
    `=== 이전 발언 (시간 순) ===\n${history}\n\n` +
    `=== 당신의 차례 ===\n` +
    `위 맥락을 바탕으로 **한 단락(3~5줄)** 으로 짧게 발언하세요. ` +
    `동의면 동의 한 줄 + 근거 1개, 반대면 반대 한 줄 + 근거 1개. 에세이·긴 분석 금지.\n\n` +
    `**다음 동작은 셋 중 하나를 고르세요**:\n` +
    `1. 토론 계속: 응답 마지막 줄에 ${mentionList} 중 한 명을 @멘션 → 그가 이어 발언.\n` +
    `2. 사용자 의견 대기: 멘션 없이 끝내면 일시정지되고 사용자 입력을 기다립니다.\n` +
    `3. 토론 종료: 충분히 합의됐다고 판단되면 응답의 **마지막 줄**을 ` +
    `\`${CONCLUSION_MARKER} 한 줄 요약\` 형태로 작성하세요. ` +
    `이 마커는 진짜 결론일 때만 쓰고, 인용·예시로는 절대 쓰지 마세요.`
  );
}

/** /debate <주제> 처리 — thread + chord_debates row 생성 + 시작 안내 user 메시지. */
export async function startDebate(args: {
  topic: string;
  channel: Channel;
  session: Session;
  participants: string[]; // 검증 끝난 참여자 키 (>=2)
}): Promise<{ thread: Thread; debate: DebateRow; firstSpeaker: string; startMessageId: string }> {
  const { topic, channel, session, participants } = args;
  const firstSpeaker = participants[0];

  // 1) 채널 본문에 user 시작 메시지
  const startMsg = await insertMessage({
    sessionId: session.id,
    role: "user",
    content: `/debate ${topic}`,
  });

  // 2) thread 생성 (parent = startMsg)
  const title = topic.length > 40 ? topic.slice(0, 40) + "…" : topic;
  const thread = await createThread(session.id, startMsg.id, title);

  // 3) 시작 안내를 thread 안 system 메시지로
  await supabase.from("chord_messages").insert({
    session_id: session.id,
    thread_id: thread.id,
    role: "system",
    content:
      `토론 시작 — 주제: ${topic}\n` +
      `참여자: ${participants.map((p) => `@${p}`).join(", ")}\n` +
      `종료: /debate end 또는 누군가 [결론] 마커, 안전망 ${MAX_TOTAL_SPEECHES}발화.`,
  });

  // 4) debate row
  const debate = await insertDebate({
    threadId: thread.id,
    topic,
    parentChannelId: channel.id,
    firstSpeaker,
  });

  return { thread, debate, firstSpeaker, startMessageId: startMsg.id };
}
