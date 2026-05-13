import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ToolCallChips } from "./ToolCallChip";
import { Markdown } from "./Markdown";
import { AgentAvatar } from "./AgentAvatar";
import { Linkified } from "./Linkified";
import type { Message } from "../types";
import type { ThreadSummary } from "../lib/threads";

type Props = {
  messages: Message[];
  emptyHint?: string;
  onStartThread?: (m: Message) => void;
  onPickOption?: (m: Message, label: string) => void;
  workspaceRoot?: string | null;
  onOpenFile?: (path: string, line?: number, col?: number) => void;
  threadByParent?: Map<string, ThreadSummary>;
  onOpenThread?: (summary: ThreadSummary, parent: Message) => void;
  onEditSave?: (m: Message, newContent: string) => void | Promise<void>;
  onDelete?: (m: Message) => void | Promise<void>;
  /** 선택 모드 on/off — true면 각 메시지에 체크박스 표시 */
  selectionMode?: boolean;
  /** 현재 선택된 메시지 id 집합 */
  selectedIds?: Set<string>;
  /** 체크박스 toggle 콜백 */
  onToggleSelect?: (m: Message) => void;
};

export function MessageList({
  messages,
  emptyHint,
  onStartThread,
  onPickOption,
  workspaceRoot,
  onOpenFile,
  threadByParent,
  onOpenThread,
  onEditSave,
  onDelete,
  selectionMode,
  selectedIds,
  onToggleSelect,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="messages empty">
        <div className="hint">{emptyHint ?? "메시지가 없습니다. 아래 입력창에 적어보세요."}</div>
      </div>
    );
  }

  return (
    <div className="messages">
      {messages.map((m) => {
        const summary = threadByParent?.get(m.id);
        return (
          <MessageItem
            key={m.id}
            m={m}
            onStartThread={onStartThread}
            onPickOption={onPickOption ? (label) => onPickOption(m, label) : undefined}
            workspaceRoot={workspaceRoot}
            onOpenFile={onOpenFile}
            threadSummary={summary}
            onOpenThread={summary && onOpenThread ? () => onOpenThread(summary, m) : undefined}
            onEditSave={onEditSave}
            onDelete={onDelete}
            selectionMode={selectionMode}
            selected={selectedIds?.has(m.id) ?? false}
            onToggleSelect={onToggleSelect}
          />
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

function MessageItem({
  m,
  onStartThread,
  onPickOption,
  workspaceRoot,
  onOpenFile,
  threadSummary,
  onOpenThread,
  onEditSave,
  onDelete,
  selectionMode,
  selected,
  onToggleSelect,
}: {
  m: Message;
  onStartThread?: (m: Message) => void;
  onPickOption?: (label: string) => void;
  workspaceRoot?: string | null;
  onOpenFile?: (path: string, line?: number, col?: number) => void;
  threadSummary?: ThreadSummary;
  onOpenThread?: () => void;
  onEditSave?: (m: Message, newContent: string) => void | Promise<void>;
  onDelete?: (m: Message) => void | Promise<void>;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (m: Message) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const isDeleted = !!m.deleted_at;

  const author =
    m.role === "user" ? "user" : m.role === "agent" ? `@${m.agent_name ?? "agent"}` : "system";
  const avatarName = m.role === "agent" ? (m.agent_name ?? "agent") : m.role === "user" ? "user" : "system";

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      taRef.current.setSelectionRange(taRef.current.value.length, taRef.current.value.length);
      autoResize(taRef.current);
    }
  }, [editing]);

  function startEdit() {
    setDraft(m.content);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(m.content);
    setEditing(false);
  }

  async function commitEdit() {
    const next = draft.trim();
    if (!next) {
      cancelEdit();
      return;
    }
    if (next === m.content) {
      setEditing(false);
      return;
    }
    setEditing(false);
    await onEditSave?.(m, next);
  }

  function onTaKey(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void commitEdit();
    }
  }

  return (
    <div
      className={`msg msg-${m.role}${isDeleted ? " msg-deleted" : ""}${selectionMode ? " msg-selectable" : ""}${selected ? " msg-selected" : ""}`}
      onClick={selectionMode && !editing ? () => onToggleSelect?.(m) : undefined}
    >
      {selectionMode && (
        <input
          type="checkbox"
          className="msg-select-checkbox"
          checked={!!selected}
          onChange={() => onToggleSelect?.(m)}
          onClick={(e) => e.stopPropagation()}
          aria-label="이 메시지 선택"
        />
      )}
      <AgentAvatar name={avatarName} size={36} />
      <div className="msg-content">
        <div className="msg-meta">
          <span className="msg-author">{author}</span>
          <span className="msg-time">{formatTime(m.created_at)}</span>
          {m.edited_at && !isDeleted && (
            <span className="msg-edited" title={`편집됨 ${formatTime(m.edited_at)}`}>(편집됨)</span>
          )}
          {onStartThread && !isDeleted && !editing && (
            <button className="msg-thread-btn" onClick={() => onStartThread(m)} title="Ctrl+T — 이 메시지에서 스레드">
              ↳ thread
            </button>
          )}
          {!isDeleted && !editing && (onEditSave || onDelete) && (
            <span className="msg-actions">
              {onEditSave && (
                <button className="msg-action-btn" onClick={startEdit} title="편집">
                  편집
                </button>
              )}
              {onDelete && (
                <button
                  className="msg-action-btn msg-action-danger"
                  onClick={() => void onDelete(m)}
                  title="삭제"
                >
                  삭제
                </button>
              )}
            </span>
          )}
        </div>
        <div className="msg-body">
          {isDeleted ? (
            <span className="msg-deleted-placeholder">(삭제된 메시지)</span>
          ) : editing ? (
            <div className="msg-edit">
              <textarea
                ref={taRef}
                className="msg-edit-input"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  autoResize(e.currentTarget);
                }}
                onKeyDown={onTaKey}
              />
              <div className="msg-edit-actions">
                <button className="msg-edit-save" onClick={() => void commitEdit()}>저장</button>
                <button className="msg-edit-cancel" onClick={cancelEdit}>취소</button>
                <span className="msg-edit-hint">Enter 저장 · Shift+Enter 줄바꿈 · Esc 취소</span>
              </div>
            </div>
          ) : m.role === "user" || m.role === "system" ? (
            <Linkified text={m.content} workspaceRoot={workspaceRoot} onOpenFile={onOpenFile} />
          ) : (
            <Markdown
              onPickOption={onPickOption}
              workspaceRoot={workspaceRoot}
              onOpenFile={onOpenFile}
            >
              {m.content}
            </Markdown>
          )}
        </div>
        {!isDeleted && Array.isArray(m.tool_calls) && m.tool_calls.length > 0 && (
          <ToolCallChips calls={m.tool_calls} />
        )}
        {!isDeleted && threadSummary && threadSummary.reply_count > 0 && onOpenThread && (
          <button className="reply-chip" onClick={onOpenThread} title="스레드 열기">
            <span className="reply-chip-mark">↳</span>
            <span className="reply-chip-count">{threadSummary.reply_count}개의 댓글</span>
            {threadSummary.last_at && (
              <span className="reply-chip-last">· {formatTime(threadSummary.last_at)}</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(400, el.scrollHeight)}px`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
