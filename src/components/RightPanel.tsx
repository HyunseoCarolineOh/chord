import { useEffect, useState, useCallback, type DragEvent } from "react";
import { listSessionFiles, addSessionFile, removeSessionFile } from "../lib/sessionFiles";
import { GitPanel } from "./GitPanel";
import { fsExistsAbs, fsHomeDir, fsList } from "../lib/fs";
import { resolveAgentPath } from "../lib/agentLoader";
import type { Channel, Session, SessionFile } from "../types";

type Props = {
  workspaceRoot: string;
  activeSession: Session | null;
  channel: Channel | null;
  onOpenGitFull: () => void;
  onOpenFile: (path: string) => void;
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

export function RightPanel({ workspaceRoot, activeSession, channel, onOpenGitFull, onOpenFile }: Props) {
  const [files, setFiles] = useState<SessionFile[]>([]);
  const [ctxFiles, setCtxFiles] = useState<ContextFile[]>([]);
  const [ctxCollapsed, setCtxCollapsed] = useState<Record<CtxGroup, boolean>>(loadCollapsed);

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
