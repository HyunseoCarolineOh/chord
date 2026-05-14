import { useEffect, useState, useCallback, useRef } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { fsRead, fsWrite, fsReadAbs, fsWriteAbs, detectLanguage, isAbsolute } from "../lib/fs";
import { MarkdownEditor } from "./MarkdownEditor";

export type EditorPendingSelection = {
  filePath: string;
  from: number;
  to: number;
  fullText: string;
  quote: string;
};

type Props = {
  root: string;
  path: string | null;
  line?: number;
  col?: number;
  onClose: () => void;
  /** 텍스트 선택 후 💬 버튼 클릭 시 호출 — RightPanel의 댓글 입력 폼을 띄움 */
  onStartComment?: (sel: EditorPendingSelection) => void;
  /** RightPanel에서 댓글로 jump 시 호출되는 helper용 — 외부에서 view를 받아 사용 */
  onViewReady?: (view: EditorView | null, filePath: string | null) => void;
};

type SelectionInfo = {
  from: number;
  to: number;
  /** 화면 좌표 (Editor 컨테이너 기준) */
  x: number;
  y: number;
};

export function Editor({ root, path, line, col, onClose, onStartComment, onViewReady }: Props) {
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [selection, setSelection] = useState<SelectionInfo | null>(null);

  const lang = path ? detectLanguage(path) : "plaintext";
  const dirty = content !== original;
  const isMarkdown = lang === "markdown";
  // .md 기본은 raw(CodeMirror). 우클릭으로 위지위그 렌더링 토글.
  const [mdRendered, setMdRendered] = useState(false);
  // 다른 파일로 이동하면 렌더 모드 리셋
  useEffect(() => { setMdRendered(false); }, [path]);
  const showWysiwyg = isMarkdown && mdRendered;

  // 부모(App)에 view 전달 — RightPanel이 jump-to-comment할 때 view를 통해 selection/scroll 조작
  useEffect(() => {
    onViewReady?.(view, path);
    return () => { onViewReady?.(null, path); };
  }, [view, path, onViewReady]);

  useEffect(() => {
    if (!view || !line || !content) return;
    const doc = view.state.doc;
    if (doc.length === 0) return;
    const clamped = Math.max(1, Math.min(line, doc.lines));
    const lineInfo = doc.line(clamped);
    const anchor = lineInfo.from + Math.max(0, (col ?? 1) - 1);
    view.dispatch({
      selection: { anchor: Math.min(anchor, lineInfo.to) },
      effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
    });
    view.focus();
  }, [view, line, col, content]);

  // 파일 로드
  useEffect(() => {
    setError(null);
    if (!path) {
      setContent("");
      setOriginal("");
      return;
    }
    setLoading(true);
    const reader = isAbsolute(path) ? fsReadAbs(path) : fsRead(root, path);
    void reader
      .then((c) => {
        setContent(c);
        setOriginal(c);
        setLoading(false);
      })
      .catch((e) => {
        setError(toMsg(e));
        setLoading(false);
      });
  }, [root, path]);

  const save = useCallback(async () => {
    if (!path) return;
    try {
      if (isAbsolute(path)) {
        await fsWriteAbs(path, content);
      } else {
        await fsWrite(root, path, content);
      }
      setOriginal(content);
      setSavedAt(Date.now());
    } catch (e) {
      setError(toMsg(e));
    }
  }, [root, path, content]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (path && dirty) void save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, path, dirty]);

  // CodeMirror selection 변경 → floating "+ 댓글" 버튼 표시 위치 계산.
  useEffect(() => {
    if (!view) return;
    const onSelChange = () => {
      const sel = view.state.selection.main;
      if (sel.from === sel.to) {
        setSelection(null);
        return;
      }
      const coords = view.coordsAtPos(sel.to);
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!coords || !containerRect) {
        setSelection(null);
        return;
      }
      setSelection({
        from: sel.from,
        to: sel.to,
        x: coords.right - containerRect.left,
        y: coords.top - containerRect.top - 6,
      });
    };
    view.dom.addEventListener("mouseup", onSelChange);
    view.dom.addEventListener("keyup", onSelChange);
    return () => {
      view.dom.removeEventListener("mouseup", onSelChange);
      view.dom.removeEventListener("keyup", onSelChange);
    };
  }, [view]);

  function startComment() {
    if (!selection || !path) return;
    onStartComment?.({
      filePath: path,
      from: selection.from,
      to: selection.to,
      fullText: content,
      quote: content.slice(selection.from, selection.to),
    });
    setSelection(null);
  }

  const extensions: ReturnType<typeof javascript>[] = [EditorView.lineWrapping];
  switch (lang) {
    case "javascript":
      extensions.push(javascript({ jsx: true, typescript: true }));
      break;
    case "html":
      extensions.push(html());
      break;
    case "css":
      extensions.push(css());
      break;
    case "json":
      extensions.push(json());
      break;
    case "markdown":
      extensions.push(markdown());
      break;
    case "python":
      extensions.push(python());
      break;
    case "rust":
      extensions.push(rust());
      break;
    case "sql":
      extensions.push(sql());
      break;
  }

  return (
    <div className="editor">
      <div className="editor-bar">
        <div className="editor-path" title={path ?? ""}>
          {path ?? "(no file)"} {dirty && <span className="dirty">●</span>}
        </div>
        <div className="editor-actions">
          {isMarkdown && (
            <button
              className="md-mode-toggle"
              onClick={() => setMdRendered((v) => !v)}
              title="우클릭으로도 전환 가능"
            >
              {mdRendered ? "📝 원본" : "📖 렌더링"}
            </button>
          )}
          {savedAt && !dirty && <span className="saved-hint">saved · {new Date(savedAt).toLocaleTimeString()}</span>}
          <button onClick={() => void save()} disabled={!path || !dirty}>
            Save (Ctrl+S)
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
      {error && <div className="editor-error">{error}</div>}
      {!path && <div className="editor-empty">트리에서 파일을 더블클릭 또는 클릭해 열어보세요.</div>}
      {path && loading && <div className="editor-empty">로딩…</div>}
      {path && !loading && showWysiwyg && (
        <div
          className="editor-md"
          onContextMenu={(e) => {
            e.preventDefault();
            setMdRendered(false);
          }}
          title="우클릭으로 원본 편집"
        >
          <MarkdownEditor
            key={`md-${path}`}
            initialContent={content}
            onChange={setContent}
          />
        </div>
      )}
      {path && !loading && !showWysiwyg && (
        <div
          className="editor-cm"
          ref={containerRef}
          onContextMenu={isMarkdown ? (e) => {
            e.preventDefault();
            setMdRendered(true);
          } : undefined}
        >
          <CodeMirror
            value={content}
            theme={oneDark}
            extensions={extensions}
            onChange={setContent}
            onCreateEditor={(v) => setView(v)}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              foldGutter: true,
              autocompletion: false,
            }}
            height="100%"
            style={{ height: "100%" }}
          />
          {selection && (
            <button
              className="comment-floating-btn"
              style={{ left: `${selection.x + 4}px`, top: `${selection.y}px` }}
              onMouseDown={(e) => {
                // mousedown으로 처리해야 selection이 풀리기 전에 잡힘
                e.preventDefault();
                startComment();
              }}
              title="이 영역에 댓글 달기 → 우측 패널에서 입력"
            >
              💬 댓글
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function toMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
