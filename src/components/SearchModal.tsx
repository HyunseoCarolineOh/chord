import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { searchMessages, searchSessions, type MessageHit } from "../lib/search";
import type { Session } from "../types";

type Props = {
  open: boolean;
  workspaceId: string | null;
  onClose: () => void;
  onJump: (target: { kind: "session"; channelId: string; sessionId: string } | { kind: "message"; channelId: string; sessionId: string; messageId: string }) => void;
};

type SessionHit = Session & { channel_name: string };

export function SearchModal({ open, workspaceId, onClose, onJump }: Props) {
  const [q, setQ] = useState("");
  const [agent, setAgent] = useState("");
  const [msgs, setMsgs] = useState<MessageHit[]>([]);
  const [sessions, setSessions] = useState<SessionHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 60);
    } else {
      setQ("");
      setMsgs([]);
      setSessions([]);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !workspaceId || !q.trim()) {
      setMsgs([]);
      setSessions([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const [m, s] = await Promise.all([
          searchMessages({ workspaceId, query: q, agent: agent || undefined }),
          searchSessions(workspaceId, q),
        ]);
        setMsgs(m);
        setSessions(s);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [open, workspaceId, q, agent]);

  return (
    <Modal open={open} title="🔍 search" onClose={onClose} width="min(720px, 92vw)">
      <div className="search-bar">
        <input
          ref={inputRef}
          className="search-input"
          placeholder="검색어 (메시지·세션 이름)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <input
          className="search-agent"
          placeholder="@agent (옵션)"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
        />
      </div>
      {error && <div className="search-error">{error}</div>}
      {loading && <div className="search-hint">검색 중…</div>}

      {sessions.length > 0 && (
        <div className="search-section">
          <div className="section-label">sessions ({sessions.length})</div>
          <ul className="search-list">
            {sessions.map((s) => (
              <li
                key={s.id}
                onClick={() => onJump({ kind: "session", channelId: s.channel_id, sessionId: s.id })}
              >
                <span className="hit-channel">#{s.channel_name}</span>
                <span className={`hit-status ${s.status}`}>{s.status}</span>
                <span className="hit-name">{s.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {msgs.length > 0 && (
        <div className="search-section">
          <div className="section-label">messages ({msgs.length})</div>
          <ul className="search-list">
            {msgs.map((m) => (
              <li
                key={m.id}
                onClick={() =>
                  m.channel_id &&
                  onJump({
                    kind: "message",
                    channelId: m.channel_id,
                    sessionId: m.session_id,
                    messageId: m.id,
                  })
                }
              >
                <span className="hit-channel">#{m.channel_name ?? "?"}</span>
                <span className="hit-author">
                  {m.role === "user" ? "user" : `@${m.agent_name ?? "agent"}`}
                </span>
                <span className="hit-snippet">{snippet(m.content, q)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && q && msgs.length === 0 && sessions.length === 0 && (
        <div className="search-hint">결과 없음</div>
      )}
    </Modal>
  );
}

function snippet(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 100);
  const start = Math.max(0, i - 30);
  const end = Math.min(text.length, i + q.length + 60);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}
