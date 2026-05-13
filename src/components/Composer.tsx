import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { AgentAvatar } from "./AgentAvatar";
import { filterSlash, type SlashCommand } from "../lib/slashCatalog";

export type PermissionMode = "default" | "plan" | "bypassPermissions";

type Props = {
  disabled?: boolean;
  placeholder?: string;
  agents?: string[];
  onSend: (text: string) => void | Promise<void>;
  permMode?: PermissionMode;
};

const ITEM_MIME = "application/x-chord-item";
const LEGACY_FILE_MIME = "application/x-chord-file";

type DroppedItem = { path: string; isDir: boolean };

type TriggerKind = "slash" | "mention";
type Trigger = {
  kind: TriggerKind;
  start: number;  // index of the trigger char (/ or @)
  end: number;    // caret position
  query: string;  // text between trigger and caret
};

type Suggestion =
  | { kind: "slash"; cmd: SlashCommand }
  | { kind: "mention"; name: string };

function readDropped(dt: DataTransfer): DroppedItem | null {
  const json = dt.getData(ITEM_MIME);
  if (json) {
    try {
      const parsed = JSON.parse(json) as DroppedItem;
      if (parsed && typeof parsed.path === "string") return parsed;
    } catch {
      // fall through
    }
  }
  const legacy = dt.getData(LEGACY_FILE_MIME);
  if (legacy) return { path: legacy, isDir: false };
  return null;
}

function hasChordType(dt: DataTransfer): boolean {
  return dt.types.includes(ITEM_MIME) || dt.types.includes(LEGACY_FILE_MIME);
}

function detectTrigger(value: string, caret: number): Trigger | null {
  // 슬래시: 입력 첫 글자만 명령으로 인식 (route()와 동일)
  if (value.startsWith("/")) {
    const space = value.indexOf(" ");
    const cmdLen = space < 0 ? value.length : space;
    if (caret <= cmdLen) {
      return { kind: "slash", start: 0, end: caret, query: value.slice(1, caret) };
    }
  }
  // 멘션: 캐럿에서 뒤로 스캔 — 공백/줄바꿈 만나면 중단, @ 만나면 트리거
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === "@") {
      const before = value[i - 1];
      if (i === 0 || before === " " || before === "\n" || before === "\t") {
        const q = value.slice(i + 1, caret);
        if (/^[a-zA-Z0-9_-]*$/.test(q)) {
          return { kind: "mention", start: i, end: caret, query: q };
        }
      }
      return null;
    }
    if (ch === " " || ch === "\n" || ch === "\t") return null;
  }
  return null;
}

function filterAgents(agents: string[], query: string, limit = 8): string[] {
  const q = query.toLowerCase();
  if (!q) return agents.slice(0, limit);
  return agents.filter((a) => a.toLowerCase().includes(q)).slice(0, limit);
}

export function Composer({ disabled, placeholder, agents = [], onSend, permMode = "default" }: Props) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [value]);

  const suggestions: Suggestion[] =
    trigger?.kind === "slash"
      ? filterSlash(trigger.query).map((cmd) => ({ kind: "slash", cmd }))
      : trigger?.kind === "mention"
        ? filterAgents(agents, trigger.query).map((name) => ({ kind: "mention", name }))
        : [];

  // 트리거 변할 때 active index 초기화
  useEffect(() => {
    setActiveIdx(0);
  }, [trigger?.kind, trigger?.start, trigger?.query]);

  function updateTriggerFromCaret(nextValue: string) {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? nextValue.length;
    const t = detectTrigger(nextValue, caret);
    setTrigger(t);
  }

  function onChange(next: string) {
    setValue(next);
    // setState는 비동기 — caret 위치는 다음 tick에 정확
    requestAnimationFrame(() => updateTriggerFromCaret(next));
  }

  function applySuggestion(s: Suggestion) {
    if (!trigger) return;
    const ta = taRef.current;
    let insertText = "";
    if (s.kind === "slash") {
      insertText = s.cmd.insert;
    } else {
      insertText = `@${s.name} `;
    }
    const next = value.slice(0, trigger.start) + insertText + value.slice(trigger.end);
    setValue(next);
    setTrigger(null);
    setTimeout(() => {
      if (!ta) return;
      ta.focus();
      const pos = trigger.start + insertText.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }

  async function send() {
    const text = value.trim();
    if (!text || busy || disabled) return;
    setBusy(true);
    try {
      await onSend(text);
      setValue("");
      setTrigger(null);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (trigger && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        applySuggestion(suggestions[activeIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setTrigger(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function onCaretMaybeMoved() {
    requestAnimationFrame(() => updateTriggerFromCaret(value));
  }

  function onDragOver(e: DragEvent<HTMLElement>) {
    // 무조건 preventDefault — dragover에서 preventDefault 없으면 drop 이벤트 자체가 발생 안 함.
    // dataTransfer.types는 dragover 단계에 일부 케이스에서 비어 보일 수 있어 type 체크는 visual feedback 용도만.
    e.preventDefault();
    e.stopPropagation();
    if (hasChordType(e.dataTransfer)) {
      e.dataTransfer.dropEffect = "copy";
      setHover(true);
    } else {
      e.dataTransfer.dropEffect = "none";
    }
  }

  function onDragLeave(e: DragEvent<HTMLElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setHover(false);
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    setHover(false);
    const item = readDropped(e.dataTransfer);
    if (!item) return;  // chord 데이터 아니면 textarea 기본 처리에 맡김
    e.preventDefault();
    e.stopPropagation();

    const insert = item.isDir ? `[folder:${item.path}] ` : `[file:${item.path}] `;
    const ta = taRef.current;
    if (!ta) {
      setValue((v) => v + insert);
      return;
    }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + insert + value.slice(end);
    setValue(next);
    setTimeout(() => {
      ta.focus();
      const pos = start + insert.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }

  const showAutocomplete = trigger != null;

  return (
    <div
      className={`composer ${hover ? "drop-hover" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {permMode !== "default" && (
        <div className={`composer-mode-chip mode-${permMode}`} title="Shift+Tab — 모드 전환">
          {permMode === "plan" ? "📝 plan mode" : "⚡ bypass permissions"}
          <span className="mode-hint">Shift+Tab</span>
        </div>
      )}
      {showAutocomplete && (
        <div className="autocomplete" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {suggestions.length === 0 ? (
            <div className="ac-empty">
              {trigger!.kind === "slash"
                ? `명령어 후보 없음: /${trigger!.query}`
                : `에이전트 후보 없음: @${trigger!.query}`}
            </div>
          ) : (
            suggestions.map((s, i) => (
              <div
                key={s.kind === "slash" ? s.cmd.label : `@${s.name}`}
                className={`ac-item ${i === activeIdx ? "active" : ""}`}
                role="option"
                aria-selected={i === activeIdx}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => applySuggestion(s)}
              >
                {s.kind === "slash" ? (
                  <>
                    <span className="ac-trigger">/</span>
                    <span className="ac-label">{s.cmd.label.replace(/^\//, "")}</span>
                    <span className="ac-desc">{s.cmd.desc}</span>
                  </>
                ) : (
                  <>
                    <AgentAvatar name={s.name} size={20} />
                    <span className="ac-label">@{s.name}</span>
                  </>
                )}
              </div>
            ))
          )}
          <div className="ac-hint">
            <span>↑↓ 이동</span>
            <span>Tab/Enter 선택</span>
            <span>Esc 닫기</span>
          </div>
        </div>
      )}
      <textarea
        ref={taRef}
        className="composer-input"
        value={value}
        placeholder={placeholder ?? "메시지 — Enter 전송, Shift+Enter 줄바꿈, @ 멘션 · / 명령어 자동완성, 트리에서 파일/폴더 drop"}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onKeyUp={onCaretMaybeMoved}
        onClick={onCaretMaybeMoved}
        onBlur={() => setTimeout(() => setTrigger(null), 120)}
        onDragOver={onDragOver}
        onDrop={onDrop}
        disabled={disabled || busy}
        rows={1}
      />
      <button
        className="composer-send"
        onClick={() => void send()}
        disabled={disabled || busy || !value.trim()}
      >
        {busy ? "…" : "Send"}
      </button>
    </div>
  );
}
