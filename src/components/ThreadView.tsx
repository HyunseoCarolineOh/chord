import { useEffect, useState, useCallback } from "react";
import { listThreadMessages, type ThreadSummary } from "../lib/threads";
import { Composer, type PermissionMode } from "./Composer";
import { MessageList } from "./MessageList";
import { ForkDialog } from "./ForkDialog";
import { supabase } from "../lib/supabase";
import { route } from "../lib/router";
import {
  editMessageContent,
  softDeleteMessage,
  softDeleteThreadMessagesAfter,
} from "../lib/messages";
import { getDebate } from "../lib/debate";
import { runSlash } from "../lib/slash";
import { loadComments } from "../lib/comments";
import { notify } from "../lib/notify";
import type { Thread, Message, Channel, Workspace, Session, FileComment } from "../types";
import type { ForkResult } from "../lib/fork";

export type DispatchDebateSpeakerFn = (
  speakerKey: string,
  threadId: string,
  participants: string[],
  channel: Channel,
  workspaceRoot: string,
  sessionId: string,
) => Promise<void>;

const APPLY_COMMENTS_RE = /(?:댓글|코멘트|comments?)\s*(?:반영|적용|처리|해줘|해\s*주세요?|해라|apply)|apply\s+comments?/i;

function shouldApplyComments(text: string): boolean {
  return APPLY_COMMENTS_RE.test(text);
}

function buildCommentsBlock(comments: FileComment[]): string {
  if (comments.length === 0) return "";
  const byFile = new Map<string, FileComment[]>();
  for (const c of comments) {
    const arr = byFile.get(c.file_path) ?? [];
    arr.push(c);
    byFile.set(c.file_path, arr);
  }
  let block =
    "\n\n## 사용자가 요청한 댓글 반영\n" +
    "이 스레드에서 만들어진 미해결 댓글들입니다. Read/Edit 도구로 해당 파일을 직접 수정하세요.\n" +
    "반영 완료한 댓글은 응답에 `(id: xxx)` 형식으로 명시하면 사용자가 확인 후 직접 ✓ 해결 처리합니다.\n\n";
  for (const [file, list] of byFile) {
    block += `### ${file}\n`;
    for (const c of list) {
      block += `- (id: ${c.id})\n`;
      block += `  - 대상 텍스트: ${JSON.stringify(c.anchor.quote)}\n`;
      if (c.anchor.prefix) block += `  - 앞 컨텍스트: ${JSON.stringify(c.anchor.prefix)}\n`;
      if (c.anchor.suffix) block += `  - 뒤 컨텍스트: ${JSON.stringify(c.anchor.suffix)}\n`;
      block += `  - 댓글 본문: ${c.body}\n`;
    }
    block += "\n";
  }
  return block;
}

type Props = {
  thread: Thread;
  channel: Channel;
  workspace: Workspace;
  workspaceRoot: string;
  activeSession: Session | null;
  parentMessage: Message | null;
  onCallAgent: (agentName: string, channel: Channel, workspaceRoot: string, sessionId: string, threadId: string, prompt: string) => Promise<{ fullText: string }>;
  /** /debate start intent 처리 — App.tsx의 dispatchDebateSpeaker를 주입 */
  onDispatchDebateSpeaker?: DispatchDebateSpeakerFn;
  /** 호출자가 탭을 닫을 때 사용 — ThreadView 내부에서는 더 이상 close 버튼이 없음 */
  onClose?: () => void;
  onOpenFile?: (path: string, line?: number, col?: number) => void;
  permMode?: PermissionMode;
  /** 포크 대상 후보 — 같은 채널 안 다른 스레드 목록 (현재 스레드 제외) */
  forkTargets?: ThreadSummary[];
  /** 포크 완료 후 부모에서 후속 처리 (탭 열기 등) */
  onForked?: (result: ForkResult, targetThreadId: string) => void;
};

export function ThreadView({ thread, channel, workspace, workspaceRoot, activeSession, parentMessage, onCallAgent, onDispatchDebateSpeaker, onOpenFile, permMode, forkTargets, onForked }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 메시지 선택 / 포크
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [forkOpen, setForkOpen] = useState(false);
  const toggleSelect = useCallback((m: Message) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(m.id)) next.delete(m.id);
      else next.add(m.id);
      return next;
    });
  }, []);

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

    if (r.kind === "slash") {
      // /debate (start / status / end) — 스레드 컨텍스트로 라우터에 위임
      if (r.command === "debate") {
        let result: Awaited<ReturnType<typeof runSlash>>;
        try {
          result = await runSlash(channel, workspace, r.command, r.args, activeSession, thread);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          return;
        }
        if (!result.ok) {
          setError(result.message);
          return;
        }
        // 결과 안내를 스레드 안 system 메시지로 (start는 startDebate가 이미 안내 메시지를 박았지만, 결과 라인도 따로 표시)
        try {
          await supabase.from("chord_messages").insert({
            session_id: thread.session_id,
            thread_id: thread.id,
            role: "system",
            content: result.message,
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
        // 시작이면 첫 발화자 dispatch
        if (result.debate?.kind === "start" && activeSession && onDispatchDebateSpeaker) {
          const d = result.debate;
          void onDispatchDebateSpeaker(
            d.firstSpeaker,
            d.thread.id,
            d.participants,
            channel,
            workspaceRoot,
            activeSession.id,
          );
        }
        if (result.debate?.kind === "end") {
          const ended = await getDebate(thread.id);
          if (ended) {
            void notify("chord · 토론 종료", `${ended.topic ?? "토론"} — 사용자 명령으로 종료`);
          }
        }
        return;
      }

      // 그 외 슬래시 명령은 스레드 안에서 처리하지 않음 — 채널 본문으로 안내.
      // (그대로 agent에 raw 텍스트로 가면 "스킬 사용 불가" 같은 엉뚱한 응답이 생김)
      try {
        await supabase.from("chord_messages").insert({
          session_id: thread.session_id,
          thread_id: thread.id,
          role: "system",
          content:
            `슬래시 명령 \`/${r.command}\`은 스레드 안에서 실행할 수 없습니다. ` +
            `채널 본문으로 돌아가서 사용하세요. (스레드 안에서 허용: /debate ...)`,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
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
    // 스레드에 debate가 있었다면 그 참가자도 허용 (channel.agent_ids에 없어도)
    const debate = await getDebate(thread.id);
    const debateParticipants = debate ? Object.keys(debate.round_counts ?? {}) : [];
    const allowed = new Set<string>([...channel.agent_ids, ...debateParticipants]);

    let targets: string[] = [];
    if (r.kind === "mention") {
      targets = r.agents.filter((a) => allowed.has(a));
      const unknown = r.agents.filter((a) => !allowed.has(a));
      for (const a of unknown) {
        try {
          await supabase.from("chord_messages").insert({
            session_id: thread.session_id,
            thread_id: thread.id,
            role: "system",
            content: `@${a} 은 이 채널/토론의 에이전트가 아닙니다. /channel agents add ${a} 로 추가하세요.`,
          });
        } catch { /* 안내 실패는 무시 */ }
      }
    } else if (r.kind === "plain") {
      // 명시 멘션 없으면 — 스레드 안의 가장 최근 agent 메시지의 작성자를 자동 타겟.
      // (Step 3 확인 답 같은 짧은 답을 자연스럽게 흘려보내기 위함)
      const lastAgent = [...messages].reverse().find((m) => m.role === "agent" && m.agent_name);
      if (lastAgent?.agent_name && allowed.has(lastAgent.agent_name)) {
        targets = [lastAgent.agent_name];
      }
    }

    if (targets.length === 0) {
      // plain 메시지인데 응답할 에이전트가 없음 — 사용자에게 안내
      if (r.kind === "plain") {
        try {
          await supabase.from("chord_messages").insert({
            session_id: thread.session_id,
            thread_id: thread.id,
            role: "system",
            content: "이 스레드에 응답할 에이전트가 없습니다. @<agent>로 명시 호출하세요.",
          });
        } catch { /* swallow */ }
      }
      return;
    }

    // 3. 각 타겟 호출 — 컨텍스트로 스레드 전체 메시지 텍스트를 system prompt 보조에 박음
    let commentsBlock = "";
    if (shouldApplyComments(r.raw)) {
      try {
        const all = await loadComments(workspaceRoot);
        const mine = all.filter((c) => c.thread_id === thread.id && c.status === "open");
        commentsBlock = buildCommentsBlock(mine);
      } catch (e) {
        console.error("comments load failed", e);
      }
    }

    let promptForAgent: string;
    if (debate?.ended) {
      // 종료된 토론 — transcript echo 방지. 짧고 명시적인 prompt.
      promptForAgent =
        `이 스레드는 이미 종료된 /debate 입니다 (주제: ${debate.topic}).\n` +
        `사용자가 추가 메시지를 남겼습니다:\n\n${r.raw}\n\n` +
        `**이전 발언을 다시 나열하거나 그대로 출력하지 마세요.** 위 메시지에만 짧게 답하세요.${commentsBlock}`;
    } else {
      const transcript = await buildTranscript(thread.id);
      promptForAgent = transcript
        ? `${transcript}\n\n---\n사용자의 새 메시지: ${r.raw}\n위 흐름을 **이어서** 답하세요. ` +
          `**이전 발언을 그대로 다시 출력하지 말 것.** 'OK'/'ㅇㅇ' 같은 짧은 승인이면 SOP의 다음 단계를 즉시 진행하세요.${commentsBlock}`
        : `${r.raw}${commentsBlock}`;
    }

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
      let commentsBlock = "";
      if (shouldApplyComments(promptText)) {
        try {
          const all = await loadComments(workspaceRoot);
          const mine = all.filter((c) => c.thread_id === thread.id && c.status === "open");
          commentsBlock = buildCommentsBlock(mine);
        } catch (e) {
          console.error("comments load failed", e);
        }
      }
      const debateForEdit = await getDebate(thread.id);
      let promptForAgent: string;
      if (debateForEdit?.ended) {
        promptForAgent =
          `이 스레드는 이미 종료된 /debate 입니다 (주제: ${debateForEdit.topic}).\n` +
          `사용자가 메시지를 편집했습니다:\n\n${promptText}\n\n` +
          `**이전 발언을 다시 나열하거나 그대로 출력하지 마세요.** 위 메시지에만 짧게 답하세요.${commentsBlock}`;
      } else {
        const transcript = await buildTranscript(thread.id);
        promptForAgent = transcript
          ? `${transcript}\n\n---\n사용자의 (편집된) 메시지: ${promptText}\n위 흐름을 **이어서** 답하세요. ` +
            `**이전 발언을 그대로 다시 출력하지 말 것.**${commentsBlock}`
          : `${promptText}${commentsBlock}`;
      }
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
        <div className="thread-head-actions">
          <button
            className={selectionMode ? "msg-select-btn active" : "msg-select-btn"}
            onClick={() => {
              setSelectionMode((v) => !v);
              setSelectedIds(new Set());
            }}
            title="여러 메시지 선택"
          >
            {selectionMode ? `선택중 (${selectedIds.size})` : "선택"}
          </button>
          {selectionMode && selectedIds.size > 0 && (
            <button
              className="msg-fork-btn"
              onClick={() => setForkOpen(true)}
              title="선택한 메시지를 새 스레드로 포크"
            >
              ↳ 포크
            </button>
          )}
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
        selectionMode={selectionMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
      />
      {error && <div className="banner-error" onClick={() => setError(null)}>{error}</div>}
      <Composer
        onSend={onSend}
        agents={channel.agent_ids}
        placeholder="스레드 메시지 — Enter 전송 (mention 없으면 마지막 에이전트가 받음)"
        permMode={permMode}
      />
      <ForkDialog
        open={forkOpen}
        onClose={() => setForkOpen(false)}
        messageIds={Array.from(selectedIds)}
        threads={forkTargets ?? []}
        onForked={(result, targetThreadId) => {
          setSelectionMode(false);
          setSelectedIds(new Set());
          onForked?.(result, targetThreadId);
        }}
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
