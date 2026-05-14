import { useEffect, useState, useCallback, useRef, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { listSessionFiles, addSessionFile, removeSessionFile } from "../lib/sessionFiles";
import { GitPanel } from "./GitPanel";
import { fsExistsAbs, fsHomeDir, fsList } from "../lib/fs";
import { resolveAgentPath } from "../lib/agentLoader";
import {
  loadCommentsForFile,
  addComment,
  resolveComment,
  reopenComment,
  deleteComment,
  makeAnchor,
  resolveAnchor,
  type AnchorMatch,
} from "../lib/comments";
import { EditorView } from "@uiw/react-codemirror";
import type { Channel, Session, SessionFile, FileComment } from "../types";
import type { EditorPendingSelection } from "./Editor";

type Props = {
  workspaceRoot: string;
  activeSession: Session | null;
  channel: Channel | null;
  onOpenGitFull: () => void;
  onOpenFile: (path: string) => void;
  /** 현재 SidePanel에 활성화된 file 탭의 경로 (없으면 null) */
  activeFilePath?: string | null;
  /** 그 파일이 어느 스레드에서 열렸는지 — 새 댓글에 thread_id로 부착 */
  activeFileThreadId?: string | null;
  /** Editor가 띄운 pending 선택 — RightPanel이 받아 입력 폼 표시 */
  pendingComment?: EditorPendingSelection | null;
  /** 입력 완료/취소 시 부모가 pendingComment 클리어 */
  onClearPendingComment?: () => void;
  /** Editor view (jump-to-comment용). 활성 file 탭의 path와 매칭될 때만 의미 있음 */
  editorView?: EditorView | null;
  editorViewFilePath?: string | null;
};

type ContextFile = {
  key: string;
  label: string;       // 표시용 짧은 이름 (예: "CLAUDE.md")
  group: "claude" | "agent" | "memory";
  hint?: string;       // 부가 설명 (예: "workspace", "global", agent 이름)
  absPath: string;
};

/** workspaceRoot 절대경로 → Claude Code projects 폴더 인코딩 (`:`, `/`, `\` → `-`). */
function encodeWorkspaceForClaude(root: string): string {
  return root.replace(/[:/\\]/g, "-");
}

type CtxGroup = ContextFile["group"];
const CTX_GROUPS: readonly CtxGroup[] = ["claude", "agent", "memory"] as const;
const CTX_COLLAPSED_KEY = "chord-ctxfiles-collapsed-v1";

function loadCollapsed(): Record<CtxGroup, boolean> {
  const fallback: Record<CtxGroup, boolean> = { claude: true, agent: true, memory: true };
  try {
    const raw = localStorage.getItem(CTX_COLLAPSED_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      claude: parsed.claude ?? true,
      agent: parsed.agent ?? true,
      memory: parsed.memory ?? true,
    };
  } catch {
    return fallback;
  }
}

function groupLabel(g: CtxGroup): string {
  switch (g) {
    case "claude": return "claude.md";
    case "agent": return "agents";
    case "memory": return "memory";
  }
}

export function RightPanel({
  workspaceRoot,
  activeSession,
  channel,
  onOpenGitFull,
  onOpenFile,
  activeFilePath,
  activeFileThreadId,
  pendingComment,
  onClearPendingComment,
  editorView,
  editorViewFilePath,
}: Props) {
  const [files, setFiles] = useState<SessionFile[]>([]);
  const [ctxFiles, setCtxFiles] = useState<ContextFile[]>([]);
  const [ctxCollapsed, setCtxCollapsed] = useState<Record<CtxGroup, boolean>>(loadCollapsed);

  // ===== 댓글 상태 =====
  const [comments, setComments] = useState<FileComment[]>([]);
  const [draft, setDraft] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  // pending 등장 시 textarea focus
  useEffect(() => {
    if (pendingComment && draftRef.current) {
      draftRef.current.focus();
      setDraft("");
    }
  }, [pendingComment]);

  // 활성 file path 바뀌면 댓글 다시 로드
  const reloadComments = useCallback(async () => {
    if (!activeFilePath) {
      setComments([]);
      return;
    }
    try {
      setComments(await loadCommentsForFile(workspaceRoot, activeFilePath));
    } catch (e) {
      console.error("comments load failed", e);
    }
  }, [workspaceRoot, activeFilePath]);
  useEffect(() => { void reloadComments(); }, [reloadComments]);

  async function commitComment() {
    if (!pendingComment) return;
    const body = draft.trim();
    if (!body) {
      onClearPendingComment?.();
      setDraft("");
      return;
    }
    const anchor = makeAnchor(pendingComment.fullText, pendingComment.from, pendingComment.to);
    try {
      await addComment(workspaceRoot, {
        file_path: pendingComment.filePath,
        anchor,
        body,
        author: "user",
        thread_id: activeFileThreadId ?? null,
        session_id: activeSession?.id ?? null,
      });
      onClearPendingComment?.();
      setDraft("");
      await reloadComments();
    } catch (e) {
      setError(toMsg(e));
    }
  }

  function cancelComment() {
    onClearPendingComment?.();
    setDraft("");
  }

  function onDraftKey(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelComment();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void commitComment();
    }
  }

  async function onResolve(id: string) {
    try { await resolveComment(workspaceRoot, id); await reloadComments(); }
    catch (e) { setError(toMsg(e)); }
  }
  async function onReopen(id: string) {
    try { await reopenComment(workspaceRoot, id); await reloadComments(); }
    catch (e) { setError(toMsg(e)); }
  }
  async function onDelete(id: string) {
    if (!confirm("이 댓글을 삭제할까요?")) return;
    try { await deleteComment(workspaceRoot, id); await reloadComments(); }
    catch (e) { setError(toMsg(e)); }
  }

  function jumpToComment(_c: FileComment, match: AnchorMatch | null) {
    if (!match) return;
    if (editorView && editorViewFilePath === activeFilePath) {
      editorView.dispatch({
        selection: { anchor: match.start, head: match.end },
        effects: EditorView.scrollIntoView(match.start, { y: "center" }),
      });
      editorView.focus();
    }
  }

  // 댓글 + 현재 활성 view 본문에서 매칭 위치 계산 — view 본문이 없으면 anchor만 표시
  const liveText = editorView && editorViewFilePath === activeFilePath ? editorView.state.doc.toString() : null;
  const commentsWithMatch = comments.map((c) => ({
    c,
    match: liveText ? resolveAnchor(liveText, c.anchor) : null,
  }));
  const visibleComments = commentsWithMatch.filter(({ c }) => showResolved || c.status === "open");
  const openCount = comments.filter((c) => c.status === "open").length;
  const resolvedCount = comments.length - openCount;

  useEffect(() => {
    try { localStorage.setItem(CTX_COLLAPSED_KEY, JSON.stringify(ctxCollapsed)); } catch { /* swallow */ }
  }, [ctxCollapsed]);

  function toggleCtxGroup(g: CtxGroup) {
    setCtxCollapsed((c) => ({ ...c, [g]: !c[g] }));
  }

  const reload = useCallback(async () => {
    if (!activeSession) {
      setFiles([]);
      return;
    }
    try {
      setFiles(await listSessionFiles(activeSession.id));
    } catch {
      /* swallow */
    }
  }, [activeSession]);

  useEffect(() => { void reload(); }, [reload]);

  // 컨텍스트 파일 (CLAUDE.md, global, agent .md, memory) 로드
  const reloadCtxFiles = useCallback(async () => {
    const wsRoot = workspaceRoot.replace(/\\/g, "/");
    const home = (await fsHomeDir().catch(() => "")).replace(/\\/g, "/");
    const out: ContextFile[] = [];

    // 1) workspace CLAUDE.md
    const wsClaude = `${wsRoot}/CLAUDE.md`;
    if (await fsExistsAbs(wsClaude).catch(() => false)) {
      out.push({ key: "ws-claude", label: "CLAUDE.md", group: "claude", hint: "workspace", absPath: wsClaude });
    }

    // 2) global ~/.claude/CLAUDE.md
    if (home) {
      const globalClaude = `${home}/.claude/CLAUDE.md`;
      if (await fsExistsAbs(globalClaude).catch(() => false)) {
        out.push({ key: "global-claude", label: "CLAUDE.md", group: "claude", hint: "global", absPath: globalClaude });
      }
    }

    // 3) 채널 agent_ids 해당 .md
    if (channel && channel.agent_ids.length > 0) {
      for (const name of channel.agent_ids) {
        const p = await resolveAgentPath(workspaceRoot, name).catch(() => null);
        if (p) {
          out.push({ key: `agent-${name}`, label: `${name}.md`, group: "agent", hint: name, absPath: p });
        }
      }
    }

    // 4) ~/.claude/projects/<encoded>/memory/*.md
    if (home) {
      const encoded = encodeWorkspaceForClaude(workspaceRoot);
      const memoryRoot = `${home}/.claude/projects/${encoded}/memory`;
      try {
        const entries = await fsList(memoryRoot, "");
        for (const e of entries) {
          if (e.is_dir) continue;
          if (!e.name.toLowerCase().endsWith(".md")) continue;
          out.push({
            key: `mem-${e.path}`,
            label: e.name,
            group: "memory",
            hint: "memory",
            absPath: `${memoryRoot}/${e.path}`,
          });
        }
      } catch {
        /* memory 폴더 없음 — 무시 */
      }
    }

    setCtxFiles(out);
  }, [workspaceRoot, channel]);

  useEffect(() => { void reloadCtxFiles(); }, [reloadCtxFiles]);

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!activeSession) return;
    if (e.dataTransfer.types.includes("application/x-chord-file")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }

  async function onDrop(e: DragEvent<HTMLDivElement>) {
    if (!activeSession) return;
    const path = e.dataTransfer.getData("application/x-chord-file");
    if (!path) return;
    e.preventDefault();
    try {
      await addSessionFile(activeSession.id, path, "primary");
      await reload();
    } catch {
      /* swallow */
    }
  }

  async function remove(path: string) {
    if (!activeSession) return;
    await removeSessionFile(activeSession.id, path);
    await reload();
  }

  return (
    <aside className="right-panel">
      {(activeFilePath || pendingComment) && (
        <div className="right-section comments-section">
          <div className="section-label">
            comments
            {activeFilePath && (
              <span className="hint-mini" title={activeFilePath}>
                {" · "}{activeFilePath.split(/[\\/]/).pop()}
              </span>
            )}
            {resolvedCount > 0 && (
              <button
                className="rp-expand"
                onClick={() => setShowResolved((v) => !v)}
                title="해결된 댓글 토글"
              >
                {showResolved ? `해결 ${resolvedCount} ▾` : `해결 ${resolvedCount} ▸`}
              </button>
            )}
          </div>
          {error && <div className="rp-empty" style={{ color: "var(--danger)" }}>{error}</div>}
          {pendingComment && (
            <div className="editor-comment editor-comment-composing">
              <div className="editor-comment-quote">
                “{pendingComment.quote.slice(0, 80)}{pendingComment.quote.length > 80 ? "…" : ""}”
              </div>
              <textarea
                ref={draftRef}
                className="editor-comment-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onDraftKey}
                placeholder="댓글 — Ctrl+Enter 저장 · Esc 취소"
                rows={3}
              />
              <div className="editor-comment-actions">
                <button onClick={() => void commitComment()} disabled={!draft.trim()}>저장</button>
                <button onClick={cancelComment}>취소</button>
              </div>
            </div>
          )}
          {!pendingComment && visibleComments.length === 0 && (
            <div className="rp-empty">
              {!activeFilePath
                ? "파일을 열면 댓글이 표시됩니다."
                : comments.length === 0
                  ? "텍스트를 선택하고 💬 댓글 버튼을 눌러보세요."
                  : "표시할 댓글이 없습니다."}
            </div>
          )}
          {visibleComments.map(({ c, match }) => (
            <div
              key={c.id}
              className={`editor-comment${c.status === "resolved" ? " resolved" : ""}${!match && liveText ? " orphaned" : ""}`}
            >
              <div className="editor-comment-meta">
                <span className="editor-comment-author">{c.author}</span>
                <span className="editor-comment-time">{formatTime(c.created_at)}</span>
                {liveText && !match && (
                  <span className="editor-comment-orphan-tag" title="원본 텍스트를 찾지 못함">orphaned</span>
                )}
                {match?.confidence === "weak" && (
                  <span className="editor-comment-weak-tag" title="앞뒤 컨텍스트가 변경됨 — 위치가 정확하지 않을 수 있음">drift?</span>
                )}
              </div>
              <button
                type="button"
                className="editor-comment-quote"
                onClick={() => jumpToComment(c, match)}
                title={match ? "댓글이 가리키는 위치로 이동" : "위치를 찾지 못함"}
                disabled={!match}
              >
                “{c.anchor.quote.slice(0, 80)}{c.anchor.quote.length > 80 ? "…" : ""}”
              </button>
              <div className="editor-comment-body">{c.body}</div>
              <div className="editor-comment-actions">
                {c.status === "open" ? (
                  <button onClick={() => void onResolve(c.id)} title="해결 처리">✓ 해결</button>
                ) : (
                  <button onClick={() => void onReopen(c.id)} title="다시 열기">↩ 다시 열기</button>
                )}
                <button onClick={() => void onDelete(c.id)} title="삭제" className="editor-comment-del">삭제</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="right-section session-files" onDragOver={onDragOver} onDrop={onDrop}>
        <div className="section-label">
          session files
          {activeSession && <span className="hint-mini"> · 트리에서 drop</span>}
        </div>
        {!activeSession ? (
          <div className="rp-empty">no active session</div>
        ) : files.length === 0 ? (
          <div className="rp-empty">drop a file here</div>
        ) : (
          <ul className="sf-list">
            {files.map((f) => (
              <li key={f.id} className={`sf-item ${f.role}`}>
                <span className="sf-role">{f.role === "primary" ? "★" : "·"}</span>
                <span className="sf-path">{f.path}</span>
                <button className="sf-remove" onClick={() => void remove(f.path)} title="remove">×</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="right-section context-files">
        <div className="section-label">context files</div>
        {ctxFiles.length === 0 ? (
          <div className="rp-empty">no CLAUDE.md, agent, memory files</div>
        ) : (
          CTX_GROUPS.map((g) => {
            const items = ctxFiles.filter((f) => f.group === g);
            if (items.length === 0) return null;
            const collapsed = ctxCollapsed[g];
            return (
              <div key={g} className={`ctx-group ctx-group-${g}`}>
                <button
                  type="button"
                  className="ctx-group-header"
                  onClick={() => toggleCtxGroup(g)}
                  aria-expanded={!collapsed}
                >
                  <span className="ctx-group-caret">{collapsed ? "▸" : "▾"}</span>
                  <span className="ctx-group-name">{groupLabel(g)}</span>
                  <span className="ctx-group-count">{items.length}</span>
                </button>
                {!collapsed && (
                  <ul className="sf-list">
                    {items.map((f) => (
                      <li
                        key={f.key}
                        className={`sf-item ctx ${f.group}`}
                        onClick={() => onOpenFile(f.absPath)}
                        title={f.absPath}
                      >
                        <span className="sf-role">{groupGlyph(f.group)}</span>
                        <span className="sf-path">
                          {f.label}
                          {f.hint && <span className="ctx-hint"> · {f.hint}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="right-section git-mini">
        <div className="section-label">
          git
          <button className="rp-expand" onClick={onOpenGitFull} title="Ctrl+G — full panel">⤢</button>
        </div>
        <GitPanel root={workspaceRoot} />
      </div>
    </aside>
  );
}

function groupGlyph(g: ContextFile["group"]): string {
  switch (g) {
    case "claude": return "📘";
    case "agent": return "🤖";
    case "memory": return "🧠";
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
