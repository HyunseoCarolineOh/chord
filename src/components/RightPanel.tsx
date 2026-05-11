import { useEffect, useState, useCallback, type DragEvent } from "react";
import { listSessionFiles, addSessionFile, removeSessionFile } from "../lib/sessionFiles";
import { GitPanel } from "./GitPanel";
import type { Session, SessionFile } from "../types";

type Props = {
  workspaceRoot: string;
  activeSession: Session | null;
  onOpenGitFull: () => void;
};

export function RightPanel({ workspaceRoot, activeSession, onOpenGitFull }: Props) {
  const [files, setFiles] = useState<SessionFile[]>([]);

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
