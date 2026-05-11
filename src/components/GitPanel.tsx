import { useEffect, useState, useCallback } from "react";
import {
  gitStatus, gitDiff, gitBranches, gitCheckout, gitLog, gitSync,
  gitStashSave, gitStashList, gitStashPop, gitStashDrop,
  gitRebaseStatus, gitRebaseStart, gitRebaseContinue, gitRebaseAbort,
} from "../lib/git";
import type { GitStatus, BranchInfo, LogEntry, StashEntry, RebaseStatus } from "../lib/git";

type Props = {
  root: string;
  full?: boolean;          // 풀 모달 vs mini
  onAfterSync?: () => void;
};

export function GitPanel({ root, full, onAfterSync }: Props) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [rebaseSt, setRebaseSt] = useState<RebaseStatus | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null);
  const [message, setMessage] = useState("");
  const [stashMsg, setStashMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [s, b, l, st, rb] = await Promise.all([
        gitStatus(root),
        full ? gitBranches(root) : Promise.resolve([] as BranchInfo[]),
        full ? gitLog(root, 20) : Promise.resolve([] as LogEntry[]),
        full ? gitStashList(root) : Promise.resolve([] as StashEntry[]),
        full ? gitRebaseStatus(root) : Promise.resolve(null as RebaseStatus | null),
      ]);
      setStatus(s);
      setBranches(b);
      setLog(l);
      setStashes(st);
      setRebaseSt(rb);
      setSelected(new Set(s.entries.map((e) => e.path)));
    } catch (e) {
      setError(toMsg(e));
    }
  }, [root, full]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function showDiff(path: string) {
    try {
      const text = await gitDiff(root, path);
      setDiff({ path, text });
    } catch (e) {
      setError(toMsg(e));
    }
  }

  async function doSync() {
    setBusy(true);
    try {
      const paths = Array.from(selected);
      await gitSync(root, paths, message);
      setMessage("");
      await reload();
      onAfterSync?.();
    } catch (e) {
      setError(toMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function checkout(name: string) {
    try {
      await gitCheckout(root, name);
      await reload();
    } catch (e) {
      setError(toMsg(e));
    }
  }

  async function rebaseOnto(name: string) {
    setBusy(true);
    try {
      const r = await gitRebaseStart(root, name);
      setRebaseSt(r);
      await reload();
    } catch (e) {
      setError(toMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function rebaseContinue() {
    setBusy(true);
    try {
      const r = await gitRebaseContinue(root);
      setRebaseSt(r);
      await reload();
    } catch (e) {
      setError(toMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function rebaseAbort() {
    setBusy(true);
    try {
      await gitRebaseAbort(root);
      await reload();
    } catch (e) {
      setError(toMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function stashSave() {
    setBusy(true);
    try {
      await gitStashSave(root, stashMsg);
      setStashMsg("");
      await reload();
    } catch (e) {
      setError(toMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function stashPop(i: number) {
    try {
      await gitStashPop(root, i);
      await reload();
    } catch (e) {
      setError(toMsg(e));
    }
  }
  async function stashDrop(i: number) {
    try {
      await gitStashDrop(root, i);
      await reload();
    } catch (e) {
      setError(toMsg(e));
    }
  }

  if (!status) {
    return <div className="git-panel"><div className="git-empty">{error ?? "git status 로딩…"}</div></div>;
  }

  return (
    <div className={`git-panel ${full ? "full" : "mini"}`}>
      <div className="git-head">
        <div className="git-branch">
          ⎇ {status.branch}
          {status.ahead > 0 && <span className="ahead"> ↑{status.ahead}</span>}
          {status.behind > 0 && <span className="behind"> ↓{status.behind}</span>}
        </div>
        <button className="git-reload" onClick={() => void reload()}>↻</button>
      </div>

      {full && rebaseSt?.in_progress && (
        <div className="git-rebase">
          <div className="section-label rebase-on">
            ⏳ rebase {rebaseSt.current ?? 0}/{rebaseSt.total}
          </div>
          {rebaseSt.conflicted_paths.length > 0 ? (
            <>
              <div className="rebase-hint">
                conflict — 외부 도구로 해결 후 Continue (해결 = 충돌 마커 제거 + git add)
              </div>
              <ul className="conflict-list">
                {rebaseSt.conflicted_paths.map((p) => (
                  <li key={p}>! {p}</li>
                ))}
              </ul>
            </>
          ) : (
            <div className="rebase-hint">충돌 없음 — Continue 가능</div>
          )}
          <div className="rebase-actions">
            <button onClick={() => void rebaseContinue()} disabled={busy}>Continue</button>
            <button onClick={() => void rebaseAbort()} disabled={busy} className="danger">Abort</button>
          </div>
        </div>
      )}

      {full && branches.length > 0 && (
        <div className="git-branches">
          <div className="section-label">branches</div>
          <ul>
            {branches.map((b) => (
              <li
                key={b.name}
                className={b.is_current ? "current" : ""}
              >
                <span
                  onClick={() => !b.is_current && void checkout(b.name)}
                  style={{ cursor: b.is_current ? "default" : "pointer", flex: 1 }}
                >
                  {b.is_current ? "▸ " : "  "}{b.name}
                  {b.upstream && <span className="upstream"> → {b.upstream}</span>}
                </span>
                {!b.is_current && !rebaseSt?.in_progress && (
                  <button className="branch-rebase" onClick={() => void rebaseOnto(b.name)} disabled={busy} title={`rebase HEAD onto ${b.name}`}>
                    rebase onto
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="git-changes">
        <div className="section-label">
          changes ({status.entries.length})
          {full && status.entries.length > 0 && (
            <span className="git-actions">
              <button onClick={() => setSelected(new Set(status.entries.map((e) => e.path)))}>all</button>
              <button onClick={() => setSelected(new Set())}>none</button>
            </span>
          )}
        </div>
        {status.entries.length === 0 ? (
          <div className="git-clean">clean</div>
        ) : (
          <ul className="git-list">
            {status.entries.map((e) => (
              <li
                key={e.path}
                className={`git-entry st-${e.status}`}
                onClick={() => full && toggle(e.path)}
              >
                {full && (
                  <input
                    type="checkbox"
                    checked={selected.has(e.path)}
                    onChange={() => toggle(e.path)}
                    onClick={(ev) => ev.stopPropagation()}
                  />
                )}
                <span className="git-mark">{statusMark(e.status)}</span>
                <span className="git-path" onClick={(ev) => { ev.stopPropagation(); void showDiff(e.path); }}>
                  {e.path}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(status.entries.length > 0 || full) && (
        <div className="git-sync">
          <input
            className="git-msg"
            placeholder="commit message (비우면 자동)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={busy}
          />
          <button
            className="git-sync-btn"
            onClick={() => void doSync()}
            disabled={busy || status.entries.length === 0}
            title="stage → commit → push 한 번에"
          >
            {busy ? "…" : "⊕ Sync"}
          </button>
        </div>
      )}

      {full && diff && (
        <div className="git-diff">
          <div className="diff-head">
            <span>{diff.path}</span>
            <button onClick={() => setDiff(null)}>×</button>
          </div>
          <pre className="diff-body">{colorizeDiff(diff.text)}</pre>
        </div>
      )}

      {full && (
        <div className="git-stash">
          <div className="section-label">stashes ({stashes.length})</div>
          <div className="stash-save">
            <input
              className="git-msg"
              placeholder="stash message (옵션)"
              value={stashMsg}
              onChange={(e) => setStashMsg(e.target.value)}
              disabled={busy}
            />
            <button onClick={() => void stashSave()} disabled={busy}>Save</button>
          </div>
          {stashes.length > 0 && (
            <ul className="stash-list">
              {stashes.map((s) => (
                <li key={s.index}>
                  <span className="stash-msg">[{s.index}] {s.message}</span>
                  <button onClick={() => void stashPop(s.index)}>pop</button>
                  <button onClick={() => void stashDrop(s.index)} className="danger">drop</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {full && log.length > 0 && (
        <div className="git-log">
          <div className="section-label">recent commits</div>
          <ul>
            {log.slice(0, 10).map((c) => (
              <li key={c.sha} title={`${c.author} <${c.email}>`}>
                <span className="sha">{c.short_sha}</span>
                <span className="msg">{c.message.split("\n")[0]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="git-error" onClick={() => setError(null)}>{error}</div>}
    </div>
  );
}

function statusMark(s: string): string {
  switch (s) {
    case "modified": return "M";
    case "added": return "A";
    case "deleted": return "D";
    case "untracked": return "?";
    case "renamed": return "R";
    case "conflicted": return "!";
    default: return " ";
  }
}

function colorizeDiff(text: string): string {
  // 단순 텍스트로 — pre의 white-space:pre-wrap이 +/- 시각화는 CSS로
  return text;
}

function toMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
