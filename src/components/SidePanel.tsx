import type { ReactNode, MouseEvent as ReactMouseEvent } from "react";

export type PanelTabMeta = {
  id: string;
  kind: "thread" | "file";
  title: string;
  unread?: boolean;
};

type Props = {
  tabs: PanelTabMeta[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  width: number;
  onResizeStart: (e: ReactMouseEvent) => void;
  children: ReactNode;
};

export function SidePanel({
  tabs,
  activeId,
  onActivate,
  onClose,
  width,
  onResizeStart,
  children,
}: Props) {
  return (
    <>
      <div
        className="panel-resizer"
        onMouseDown={onResizeStart}
        role="separator"
        aria-orientation="vertical"
        title="드래그로 폭 조정"
      />
      <aside className="side-pane" style={{ width: `${width}px` }}>
        <div className="panel-tabs" role="tablist">
          {tabs.map((t) => {
            const active = t.id === activeId;
            return (
              <div
                key={t.id}
                className={`panel-tab ${active ? "active" : ""}${t.unread ? " has-unread" : ""}`}
                onClick={() => onActivate(t.id)}
                onMouseDown={(e) => {
                  // middle-click 으로 탭 닫기
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(t.id);
                  }
                }}
                role="tab"
                aria-selected={active}
                title={t.unread ? `${t.title} — 새 메시지` : t.title}
              >
                <span className="panel-tab-icon">{t.kind === "thread" ? "↳" : "📝"}</span>
                <span className="panel-tab-title">{t.title}</span>
                {t.unread && <span className="unread-dot" aria-label="새 메시지" />}
                <button
                  className="panel-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(t.id);
                  }}
                  title="close tab"
                  aria-label="close tab"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <div className="panel-body">{children}</div>
      </aside>
    </>
  );
}
