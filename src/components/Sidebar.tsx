import { useEffect, useRef, useState } from "react";
import { FileTree } from "./FileTree";
import { Trading } from "./Trading";
import {
  searchMessages,
  searchSessions,
  searchFiles,
  type MessageHit,
  type FileHit,
} from "../lib/search";
import type { Workspace, Channel, Session, Thread, ScheduledJob } from "../types";

export type PinnedThread = Thread & { channel_id: string; channel_name: string };

type Props = {
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;

  channels: Channel[];
  selectedChannelId: string | null;
  onSelectChannel: (id: string) => void;

  activeSession: Session | null;

  workspaceRoot: string | null;
  showArchived?: boolean;
  onToggleArchived?: () => void;
  onOpenFile: (path: string) => void;
  onAttachToSession?: (path: string) => void;
  onJump?: (
    target:
      | { kind: "session"; channelId: string; sessionId: string }
      | { kind: "message"; channelId: string; sessionId: string; messageId: string },
  ) => void;
  /** Ctrl+/ 등 외부 트리거 — 토큰이 증가할 때마다 search 모드로 전환 + input focus. */
  searchFocusToken?: number;

  pinnedThreads?: PinnedThread[];
  scheduledJobs?: ScheduledJob[];
  onOpenPinnedThread?: (t: PinnedThread) => void;

  /** 새 메시지가 있는 채널 id 집합 — 채널명 옆 빨간 점 표시 */
  unreadChannels?: Set<string>;
  /** 새 메시지가 있는 thread id 집합 — pinned thread 옆 빨간 점 표시 */
  unreadThreads?: Set<string>;
};

type Mode = "channels" | "files" | "search" | "trading";

type SessionHit = Session & { channel_name: string };

export function Sidebar({
  workspaces,
  selectedWorkspaceId,
  onSelectWorkspace,
  channels,
  selectedChannelId,
  onSelectChannel,
  activeSession,
  workspaceRoot,
  showArchived,
  onToggleArchived,
  onOpenFile,
  onAttachToSession,
  onJump,
  searchFocusToken,
  pinnedThreads,
  scheduledJobs,
  onOpenPinnedThread,
  unreadChannels,
  unreadThreads,
}: Props) {
  const [mode, setMode] = useState<Mode>("channels");
  const selectedWs = workspaces.find((w) => w.id === selectedWorkspaceId);

  // ===== 검색 상태 =====
  const [sq, setSq] = useState("");
  const [sLoading, setSLoading] = useState(false);
  const [sErr, setSErr] = useState<string | null>(null);
  const [msgHits, setMsgHits] = useState<MessageHit[]>([]);
  const [sessHits, setSessHits] = useState<SessionHit[]>([]);
  const [fileHits, setFileHits] = useState<FileHit[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 외부 트리거(Ctrl+/) → search mode로 전환 + input focus
  useEffect(() => {
    if (searchFocusToken && searchFocusToken > 0) {
      setMode("search");
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 0);
    }
  }, [searchFocusToken]);

  // 검색 mode 진입 시 자동 focus
  useEffect(() => {
    if (mode === "search") {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [mode]);

  // 검색 debounce
  useEffect(() => {
    if (mode !== "search") return;
    const q = sq.trim();
    if (!q) {
      setMsgHits([]);
      setSessHits([]);
      setFileHits([]);
      setSErr(null);
      return;
    }
    setSLoading(true);
    const handle = setTimeout(async () => {
      try {
        const [m, s, f] = await Promise.all([
          selectedWorkspaceId
            ? searchMessages({ workspaceId: selectedWorkspaceId, query: q, limit: 20 })
            : Promise.resolve([] as MessageHit[]),
          selectedWorkspaceId
            ? searchSessions(selectedWorkspaceId, q)
            : Promise.resolve([] as SessionHit[]),
          workspaceRoot ? searchFiles(workspaceRoot, q, { limit: 30 }) : Promise.resolve([] as FileHit[]),
        ]);
        setMsgHits(m);
        setSessHits(s as SessionHit[]);
        setFileHits(f);
        setSErr(null);
      } catch (e) {
        setSErr(e instanceof Error ? e.message : String(e));
      } finally {
        setSLoading(false);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [mode, sq, selectedWorkspaceId, workspaceRoot]);

  function fmtTime(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "numeric", day: "numeric" });
  }
  function fmtRel(iso: string): string {
    const target = new Date(iso).getTime();
    const now = Date.now();
    const diffMin = Math.round((target - now) / 60000);
    if (diffMin <= 0) return "soon";
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h`;
    return new Date(iso).toLocaleDateString([], { month: "numeric", day: "numeric" });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-section workspace-picker">
        <div className="section-label">workspace</div>
        <select
          className="ws-select"
          value={selectedWorkspaceId ?? ""}
          onChange={(e) => onSelectWorkspace(e.target.value)}
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        {selectedWs && <div className="ws-path">{selectedWs.root_path}</div>}
      </div>

      <div className="sidebar-tabs">
        <button
          className={mode === "channels" ? "tab active" : "tab"}
          onClick={() => setMode("channels")}
          title="channels"
          aria-label="channels"
        >
          #
        </button>
        <button
          className={mode === "files" ? "tab active" : "tab"}
          onClick={() => setMode("files")}
          disabled={!workspaceRoot}
          title="tree"
          aria-label="tree"
        >
          📁
        </button>
        <button
          className={mode === "search" ? "tab active" : "tab"}
          onClick={() => setMode("search")}
          title="search · Ctrl+/"
          aria-label="search"
        >
          🔍
        </button>
        <button
          className={mode === "trading" ? "tab active" : "tab"}
          onClick={() => setMode("trading")}
          title="trading"
          aria-label="trading"
        >
          💹
        </button>
      </div>

      <div className="sidebar-mode">
        {mode === "trading" ? (
          <Trading />
        ) : mode === "channels" ? (
          <>
            <ul className="channel-list">
              {channels.map((c) => {
                const childPins = (pinnedThreads ?? []).filter((t) => t.channel_id === c.id);
                const hasUnread = unreadChannels?.has(c.id) ?? false;
                return (
                  <li key={c.id} className="channel-group">
                    <div
                      className={`channel-item ${c.id === selectedChannelId ? "active" : ""} ${c.archived ? "archived" : ""}${hasUnread ? " has-unread" : ""}`}
                      onClick={() => onSelectChannel(c.id)}
                      title={c.archived ? "archived" : hasUnread ? "새 메시지" : undefined}
                    >
                      <span className="hash">#</span>
                      {c.name}
                      {hasUnread && <span className="unread-dot" aria-label="새 메시지" />}
                      {c.archived && <span className="arch-tag">archived</span>}
                    </div>
                    {childPins.length > 0 && (
                      <ul className="channel-pin-list">
                        {childPins.map((t) => {
                          const job = scheduledJobs?.find((j) => j.thread_id === t.id);
                          const pinUnread = unreadThreads?.has(t.id) ?? false;
                          return (
                            <li
                              key={t.id}
                              className={`channel-pin-item${pinUnread ? " has-unread" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenPinnedThread?.(t);
                              }}
                              title={`${t.name ?? t.title} · #${t.channel_name}${pinUnread ? " · 새 메시지" : ""}`}
                            >
                              <span className="pin-tree">└</span>
                              <span className="pin-mark">📌</span>
                              <span className="pin-name">{t.name ?? t.title}</span>
                              {pinUnread && <span className="unread-dot" aria-label="새 메시지" />}
                              {job && (
                                <span className="pin-meta">
                                  {job.last_run_at && (
                                    <span className="pin-last"> · last {fmtTime(job.last_run_at)}</span>
                                  )}
                                  {job.next_run_at && (
                                    <span className="pin-next"> · next {fmtRel(job.next_run_at)}</span>
                                  )}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
              {channels.length === 0 && <li className="channel-item empty">(no channels)</li>}
            </ul>
            {onToggleArchived && (
              <button className="archive-toggle" onClick={onToggleArchived}>
                {showArchived ? "hide archived" : "show archived"}
              </button>
            )}
          </>
        ) : mode === "files" ? (
          workspaceRoot ? (
            <FileTree
              root={workspaceRoot}
              onOpenFile={onOpenFile}
              onAttachToSession={onAttachToSession}
            />
          ) : (
            <div className="rp-empty">no workspace root</div>
          )
        ) : (
          <div className="sb-search">
            <input
              ref={searchInputRef}
              className="sb-search-input"
              placeholder="메시지·세션·파일명 (Ctrl+/)"
              value={sq}
              onChange={(e) => setSq(e.target.value)}
            />
            {sErr && <div className="sb-search-error">{sErr}</div>}
            {sLoading && <div className="rp-empty">검색 중…</div>}

            {fileHits.length > 0 && (
              <div className="sb-search-group">
                <div className="sb-search-head">files ({fileHits.length})</div>
                <ul className="sf-list">
                  {fileHits.map((f) => (
                    <li
                      key={`f-${f.path}`}
                      className="sf-item ctx"
                      onClick={() =>
                        workspaceRoot &&
                        onOpenFile(`${workspaceRoot.replace(/\\/g, "/")}/${f.path}`)
                      }
                      title={f.path}
                    >
                      <span className="sf-role">📄</span>
                      <span className="sf-path">
                        {f.name}
                        <span className="ctx-hint"> · {f.path}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sessHits.length > 0 && (
              <div className="sb-search-group">
                <div className="sb-search-head">sessions ({sessHits.length})</div>
                <ul className="sf-list">
                  {sessHits.map((s) => (
                    <li
                      key={`s-${s.id}`}
                      className="sf-item ctx"
                      onClick={() =>
                        onJump?.({ kind: "session", channelId: s.channel_id, sessionId: s.id })
                      }
                      title={s.name}
                    >
                      <span className="sf-role">▶</span>
                      <span className="sf-path">
                        #{s.channel_name}
                        <span className="ctx-hint"> · {s.name}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {msgHits.length > 0 && (
              <div className="sb-search-group">
                <div className="sb-search-head">messages ({msgHits.length})</div>
                <ul className="sf-list">
                  {msgHits.map((m) => (
                    <li
                      key={`m-${m.id}`}
                      className="sf-item ctx"
                      onClick={() =>
                        m.channel_id &&
                        onJump?.({
                          kind: "message",
                          channelId: m.channel_id,
                          sessionId: m.session_id,
                          messageId: m.id,
                        })
                      }
                      title={m.content.slice(0, 200)}
                    >
                      <span className="sf-role">💬</span>
                      <span className="sf-path">
                        #{m.channel_name ?? "?"}
                        <span className="ctx-hint"> · {snippet(m.content, sq)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!sLoading &&
              sq.trim() &&
              fileHits.length === 0 &&
              sessHits.length === 0 &&
              msgHits.length === 0 && <div className="rp-empty">결과 없음</div>}
          </div>
        )}
      </div>

      <div className="sidebar-section session-info">
        <div className="section-label">session</div>
        {activeSession ? (
          <>
            <div className="session-name">{activeSession.name}</div>
            <div className="session-status">{activeSession.status}</div>
          </>
        ) : (
          <div className="session-name dim">(none — /session start &lt;name&gt;)</div>
        )}
      </div>
    </aside>
  );
}

function snippet(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 80);
  const start = Math.max(0, i - 20);
  const end = Math.min(text.length, i + q.length + 40);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}
