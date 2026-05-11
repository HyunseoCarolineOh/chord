import { useEffect, useState, useCallback } from "react";
import { listThreadMessages } from "../lib/threads";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { supabase } from "../lib/supabase";
import { route } from "../lib/router";
import {
  editMessageContent,
  softDeleteMessage,
  softDeleteThreadMessagesAfter,
} from "../lib/messages";
import { getDebate, endDebate } from "../lib/debate";
import type { Thread, Message, Channel } from "../types";

type Props = {
  thread: Thread;
  channel: Channel;
  workspaceRoot: string;
  parentMessage: Message | null;
  onCallAgent: (agentName: string, channel: Channel, workspaceRoot: string, sessionId: string, threadId: string, prompt: string) => Promise<{ fullText: string }>;
  /** 호출자가 탭을 닫을 때 사용 — ThreadView 내부에서는 더 이상 close 버튼이 없음 */
  onClose?: () => void;
  onOpenFile?: (path: string, line?: number, col?: number) => void;
};

export function ThreadView({ thread, channel, workspaceRoot, parentMessage, onCallAgent, onOpenFile }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setMessages(await listThreadMessages(thread.id));
  }, [thread.id]);

  useEffect(() => { void reload(); }, [reload]);

  // 스레드 메시지 realtime
  useEffect(() => {
    const ch = supabase
      .channel(`thread-${thread.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chord_messages", filter: `thread_id=eq.${thread.id}` },
        (p) => {
          setMessages((prev) => (prev.find((m) => m.id === (p.new as Message).id) ? prev : [...prev, p.new as Message]));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chord_messages", filter: `thread_id=eq.${thread.id}` },
        (p) => {
          const row = p.new as Message;
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === row.id);
            if (idx >= 0) return prev.map((m, i) => (i === idx ? row : m));
            // INSERT 이벤트 누락 보강 — 처음 보는 메시지면 추가
            return [...prev, row];
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [thread.id]);

  async function onSend(text: string) {
    setError(null);
    const r = route(text);

    // 토론 thread 안에서 /debate end 처리
    if (r.kind === "slash" && r.command === "debate" && r.args[0] === "end") {
      const debate = await getDebate(thread.id);
      if (!debate || debate.ended) {
        setError("이 스레드는 진행 중인 토론이 아닙니다.");
        return;
      }
      await endDebate(thread.id, "user_command");
      await supabase.from("chord_messages").insert({
        session_id: thread.session_id,
        thread_id: thread.id,
        role: "system",
        content: "토론 종료 (사용자 명령).",
      });
      return;
    }

    // 1. user 메시지 INSERT (thread_id 부착해서 한 번에)
    const { data: userMsg, error: insErr } = await supabase
      .from("chord_messages")
      .insert({
        session_id: thread.session_id,
        thread_id: thread.id,
        role: "user",
        content: r.raw,
        source: "user",
      })
      .select()
      .single();
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setMessages((prev) => (prev.find((m) => m.id === (userMsg as Message).id) ? prev : [...prev, userMsg as Message]));

    // 2. 어느 에이전트를 호출할지 결정
    let targets: string[] = [];
    if (r.kind === "mention") {
      targets = r.agents.filter((a) => channel.agent_ids.includes(a));
    } else if (r.kind === "plain" || r.kind === "slash") {
      // 명시 멘션 없으면 — 스레드 안의 가장 최근 agent 메시지의 작성자를 자동 타겟.
      // (Step 3 확인 답 같은 짧은 답을 자연스럽게 흘려보내기 위함)
      const lastAgent = [...messages].reverse().find((m) => m.role === "agent" && m.agent_name);
      if (lastAgent?.agent_name && channel.agent_ids.includes(lastAgent.agent_name)) {
        targets = [lastAgent.agent_name];
      }
    }

    if (targets.length === 0) return;

    // 3. 각 타겟 호출 — 컨텍스트로 스레드 전체 메시지 텍스트를 system prompt 보조에 박음
    const transcript = await buildTranscript(thread.id);
    const promptForAgent = transcript
      ? `${transcript}\n\n---\n사용자의 새 메시지: ${r.raw}\n위 흐름을 이어서 답하세요. 'OK'/'ㅇㅇ' 같은 짧은 승인이면 SOP의 다음 단계를 즉시 진행하세요.`
      : r.raw;

    for (const a of targets) {
      await onCallAgent(a, channel, workspaceRoot, thread.session_id, thread.id, promptForAgent);
    }
  }

  // 스레드 안 메시지 편집: 같은 스레드에서 처리.
  // user 편집이면 이후 메시지를 모두 soft-delete하고 재응답.
  const onEditThreadMessage = useCallback(
    async (m: Message, newContent: string) => {
      try {
        await editMessageContent(m.id, newContent);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      setMessages((prev) =>
        prev.map((x) =>
          x.id === m.id ? { ...x, content: newContent, edited_at: new Date().toISOString() } : x,
        ),
      );

      if (m.role !== "user") return;

      // 편집한 메시지 이후의 같은 스레드 메시지 일괄 soft-delete
      try {
        await softDeleteThreadMessagesAfter(thread.id, m.created_at);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      const nowIso = new Date().toISOString();
      setMessages((prev) =>
        prev.map((x) =>
          x.thread_id === thread.id && x.created_at > m.created_at && !x.deleted_at
            ? { ...x, deleted_at: nowIso }
            : x,
        ),
      );

      // 재응답 — 채널 본문 onSend와 동일 규칙으로 타겟 결정
      const r = route(newContent);
      const promptText = r.kind === "mention" ? r.cleanText : r.raw;
      let targets: string[] = [];
      if (r.kind === "mention") {
        targets = r.agents.filter((a) => channel.agent_ids.includes(a));
      } else if (r.kind === "plain") {
        // 편집한 메시지 직전 마지막 agent를 자동 타겟 (deleted 제외)
        const lastAgent = [...messages]
          .filter((x) => !x.deleted_at && x.created_at < m.created_at)
          .reverse()
          .find((x) => x.role === "agent" && x.agent_name);
        if (lastAgent?.agent_name && channel.agent_ids.includes(lastAgent.agent_name)) {
          targets = [lastAgent.agent_name];
        }
      }
      if (targets.length === 0) return;

      // 컨텍스트로 (살아있는) 스레드 transcript + 새 user 메시지를 전달
      const transcript = await buildTranscript(thread.id);
      const promptForAgent = transcript
        ? `${transcript}\n\n---\n사용자의 (편집된) 메시지: ${promptText}\n위 흐름을 이어서 답하세요.`
        : promptText;
      for (const a of targets) {
        await onCallAgent(a, channel, workspaceRoot, thread.session_id, thread.id, promptForAgent);
      }
    },
    [thread.id, thread.session_id, channel, workspaceRoot, onCallAgent, messages],
  );

  const onDeleteThreadMessage = useCallback(async (m: Message) => {
    try {
      await softDeleteMessage(m.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setMessages((prev) =>
      prev.map((x) => (x.id === m.id ? { ...x, deleted_at: new Date().toISOString() } : x)),
    );
  }, []);

  return (
    <div className="thread-view">
      <div className="thread-head">
        <div className="thread-title">
          <span className="thread-mark">↳</span>
          {thread.name ?? thread.title ?? "(thread)"}
        </div>
      </div>
      {parentMessage && (
        <div className="thread-parent">
          <div className="parent-label">from</div>
          <div className="parent-body">{parentMessage.content}</div>
        </div>
      )}
      <MessageList
        messages={messages}
        emptyHint={`#${channel.name} 의 스레드. Enter로 답하면 마지막 에이전트가 흐름을 이어갑니다.`}
        workspaceRoot={workspaceRoot}
        onOpenFile={onOpenFile}
        onPickOption={(_m, label) => void onSend(label)}
        onEditSave={onEditThreadMessage}
        onDelete={onDeleteThreadMessage}
      />
      {error && <div className="banner-error" onClick={() => setError(null)}>{error}</div>}
      <Composer
        onSend={onSend}
        agents={channel.agent_ids}
        placeholder="스레드 메시지 — Enter 전송 (mention 없으면 마지막 에이전트가 받음)"
      />
    </div>
  );
}

async function buildTranscript(threadId: string): Promise<string> {
  const { data } = await supabase
    .from("chord_messages")
    .select("role, agent_name, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(50);
  const rows = (data ?? []) as { role: string; agent_name: string | null; content: string }[];
  if (rows.length === 0) return "";
  return rows
    .map((m) => {
      const who = m.role === "user" ? "user" : m.role === "agent" ? `@${m.agent_name ?? "agent"}` : "system";
      return `[${who}] ${m.content}`;
    })
    .join("\n\n");
}
