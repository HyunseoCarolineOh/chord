import { useState } from "react";

type ToolCall = {
  kind?: "use" | "result";
  id?: string;
  name?: string;
  input?: unknown;
  toolUseId?: string;
  content?: unknown;
};

export function ToolCallChips({ calls }: { calls: unknown[] }) {
  if (!calls || calls.length === 0) return null;
  return (
    <div className="tool-chips">
      {calls.map((c, i) => (
        <ToolCallChip key={i} call={c as ToolCall} />
      ))}
    </div>
  );
}

function ToolCallChip({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const isUse = call.kind === "use" || (call.name !== undefined && call.input !== undefined);
  const label = isUse ? `▸ ${call.name ?? "tool"}` : `← result`;
  return (
    <div className={`tool-chip ${isUse ? "use" : "result"}`}>
      <button className="tool-chip-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} {label}
      </button>
      {open && (
        <pre className="tool-chip-body">
          {JSON.stringify(isUse ? call.input : call.content, null, 2)}
        </pre>
      )}
    </div>
  );
}
