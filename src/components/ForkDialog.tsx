import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { forkMessages, type ForkResult } from "../lib/fork";
import type { ThreadSummary } from "../lib/threads";

type Props = {
  open: boolean;
  onClose: () => void;
  /** 포크할 메시지 id 목록 */
  messageIds: string[];
  /** 대상 후보 thread 목록 (현재 thread 제외) */
  threads: ThreadSummary[];
  onForked?: (result: ForkResult, targetThreadId: string) => void;
};

function threadLabel(t: ThreadSummary): string {
  const name = t.name ?? t.title ?? "(제목 없음)";
  return `↳ ${name}  ·  ${t.reply_count}개`;
}

export function ForkDialog({
  open,
  onClose,
  messageIds,
  threads,
  onForked,
}: Props) {
  const [targetId, setTargetId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTargetId(threads[0]?.id ?? "");
      setErr(null);
      setBusy(false);
    }
  }, [open, threads]);

  const hasTargets = threads.length > 0;

  async function onConfirm() {
    if (!targetId) {
      setErr("대상 스레드를 선택하세요.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const result = await forkMessages({
        messageIds,
        targetThreadId: targetId,
      });
      onForked?.(result, targetId);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="↳ 메시지 포크" onClose={busy ? () => {} : onClose} width="min(560px, 92vw)">
      <div className="fork-dialog">
        <div className="fork-row">
          <div className="fork-label">선택된 메시지</div>
          <div className="fork-value">{messageIds.length}개</div>
        </div>

        <div className="fork-row">
          <div className="fork-label">대상 스레드</div>
          {hasTargets ? (
            <select
              className="fork-select"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={busy}
            >
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {threadLabel(t)}
                </option>
              ))}
            </select>
          ) : (
            <div className="fork-value">(같은 채널 안에 다른 스레드가 없습니다)</div>
          )}
        </div>

        <div className="fork-hint">
          선택한 메시지가 대상 스레드 끝에 그대로 복사됩니다. 원본은 그대로 유지돼요.
        </div>

        {err && <div className="fork-error">{err}</div>}

        <div className="fork-actions">
          <button className="fork-cancel" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            className="fork-confirm"
            onClick={() => void onConfirm()}
            disabled={busy || !hasTargets}
          >
            {busy ? "포크 중…" : "포크"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
