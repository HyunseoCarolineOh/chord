import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { forkMessages, type ForkResult } from "../lib/fork";
import type { Channel } from "../types";

type Props = {
  open: boolean;
  onClose: () => void;
  /** 포크할 메시지 id 목록 */
  messageIds: string[];
  /** 후보 채널 (현재 워크스페이스). 첫 번째 옵션은 "현재 채널 (새 스레드)" */
  channels: Channel[];
  /** 현재 보고 있는 채널 id — 기본 선택값 */
  currentChannelId: string | null;
  onForked?: (result: ForkResult, targetChannelId: string) => void;
};

export function ForkDialog({
  open,
  onClose,
  messageIds,
  channels,
  currentChannelId,
  onForked,
}: Props) {
  const [targetId, setTargetId] = useState<string>(currentChannelId ?? "");
  const [name, setName] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTargetId(currentChannelId ?? channels[0]?.id ?? "");
      setName(defaultThreadName());
      setErr(null);
      setBusy(false);
    }
  }, [open, currentChannelId, channels]);

  async function onConfirm() {
    if (!targetId) {
      setErr("대상 채널을 선택하세요.");
      return;
    }
    if (!name.trim()) {
      setErr("스레드 이름을 입력하세요.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const result = await forkMessages({
        messageIds,
        targetChannelId: targetId,
        threadName: name.trim(),
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
          <div className="fork-label">대상 채널</div>
          <select
            className="fork-select"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={busy}
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id === currentChannelId ? `# ${c.name} (현재)` : `# ${c.name}`}
              </option>
            ))}
          </select>
        </div>

        <div className="fork-row">
          <div className="fork-label">스레드 이름</div>
          <input
            type="text"
            className="fork-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: bd 전략 분기"
            disabled={busy}
            autoFocus
          />
        </div>

        <div className="fork-hint">
          선택한 메시지가 새 스레드로 그대로 복사됩니다. 원본은 그대로 유지돼요.
          {channels.find((c) => c.id === targetId && !c.active_session_id) && (
            <div className="fork-hint-warn">
              이 채널에 active session이 없습니다 — fork 세션이 자동 생성됩니다.
            </div>
          )}
        </div>

        {err && <div className="fork-error">{err}</div>}

        <div className="fork-actions">
          <button className="fork-cancel" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="fork-confirm" onClick={() => void onConfirm()} disabled={busy}>
            {busy ? "포크 중…" : "포크"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function defaultThreadName(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `fork ${mm}/${dd} ${hh}:${mi}`;
}
