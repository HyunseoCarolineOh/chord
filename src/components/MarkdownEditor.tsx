import { useEffect, useRef } from "react";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame-dark.css";

type Props = {
  /** 처음 한 번 로드되는 마크다운 원문. 이후 변경은 onChange로 부모에 전달. */
  initialContent: string;
  onChange: (markdown: string) => void;
};

/** Milkdown crepe 기반 Notion 스타일 라이브 위지위그 마크다운 에디터.
 *  파일 단위로 한 번만 마운트되므로 key={path}로 재마운트 유도할 것. */
export function MarkdownEditor({ initialContent, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;
    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue: initialContent,
    });
    let alive = true;
    void crepe
      .create()
      .then(() => {
        if (!alive) {
          void crepe.destroy();
          return;
        }
        crepe.on((listener) => {
          listener.markdownUpdated((_ctx, md, prev) => {
            if (md !== prev) onChange(md);
          });
        });
      })
      .catch((e) => {
        console.error("crepe init failed", e);
      });
    return () => {
      alive = false;
      void crepe.destroy().catch(() => { /* swallow */ });
    };
    // initialContent는 마운트 시점에만 사용. 변경되면 부모가 key를 바꿔 재마운트하도록.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="markdown-editor-root" ref={rootRef} />;
}
