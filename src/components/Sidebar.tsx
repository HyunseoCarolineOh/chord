import { useState } from "react";
import { FileTree } from "./FileTree";
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
  onOpenSearch?: () => void;
  onOpenFile: (path: string) => void;
  onAttachToSession?: (path: string) => void;

  pinnedThreads?: PinnedThread[];
  scheduledJobs?: ScheduledJob[];
  onOpenPinnedThread?: (t: PinnedThread) => void;
};

type Mode = "channels" | "files";

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
  onOpenSearch,
  onOpenFile,
  onAttachToSession,
  pinnedThreads,
  scheduledJobs,
  onOpenPinnedThread,
}: Props) {
  const [mode, setMode] = useState<Mode>("channels");
  const selectedWs = workspaces.find((w) => w.id === selectedWorkspaceId);

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
        >
          # channels
        </button>
        <button
          className={mode === "files" ? "tab active" : "tab"}
          onClick={() => setMode("files")}
          disabled={!workspaceRoot}
        >
          📁 tree
        </button>
        {onOpenSearch && (
          <button className="tab tab-search" onClick={onOpenSearch} title="Ctrl+/">
            🔍
          </button>
        )}
      </div>

      <div className="sidebar-mode">
        {mode === "channels" ? (
          <>
            <ul className="channel-list">
              {channels.map((c) => (
                <li
                  key={c.id}
                  className={`channel-item ${c.id === selectedChannelId ? "active" : ""} ${c.archived ? "archived" : ""}`}
                  onClick={() => onSelectChannel(c.id)}
                  title={c.archived ? "archived" : undefined}
                >
                  <span className="hash">#</span>
                  {c.name}
                  {c.archived && <span className="arch-tag">archived</span>}
                </li>
              ))}
              {channels.length === 0 && <li className="channel-item empty">(no channels)</li>}
            </ul>
            {onToggleArchived && (
              <button className="archive-toggle" onClick={onToggleArchived}>
                {showArchived ? "hide archived" : "show archived"}
              </button>
            )}
          </>
        ) : workspaceRoot ? (
          <FileTree
            root={workspaceRoot}
            onOpenFile={onOpenFile}
            onAttachToSession={onAttachToSession}
          />
        ) : (
          <div className="rp-empty">no workspace root</div>
        )}
      </div>

      {pinnedThreads && pinnedThreads.length > 0 && (
        <div className="sidebar-section pinned-section">
          <div className="section-label">📌 pinned threads</div>
          <ul className="pinned-list">
            {pinnedThreads.map((t) => {
              const job = scheduledJobs?.find((j) => j.thread_id === t.id);
              return (
                <li
                  key={t.id}
                  className="pinned-item"
                  onClick={() => onOpenPinnedThread?.(t)}
                  title={`#${t.channel_name} → ${t.name ?? t.title}`}
                >
                  <div className="pinned-name">
                    <span className="pin-mark">↳</span>
                    {t.name ?? t.title}
                  </div>
                  <div className="pinned-meta">
                    <span className="pin-ch">#{t.channel_name}</span>
                    {job && (
                      <>
                        {job.last_run_at && (
                          <span className="pin-last"> · last {fmtTime(job.last_run_at)}</span>
                        )}
                        {job.next_run_at && (
                          <span className="pin-next"> · next {fmtRel(job.next_run_at)}</span>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
