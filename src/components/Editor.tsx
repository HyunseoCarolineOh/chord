import { useEffect, useState, useCallback } from "react";
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

type Props = {
  root: string;
  path: string | null;
  line?: number;
  col?: number;
  onClose: () => void;
};

export function Editor({ root, path, line, col, onClose }: Props) {
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [view, setView] = useState<EditorView | null>(null);

  const lang = path ? detectLanguage(path) : "plaintext";
  const dirty = content !== original;

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

  const extensions: ReturnType<typeof javascript>[] = [];
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
      {path && !loading && (
        <div className="editor-cm">
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
        </div>
      )}
    </div>
  );
}

function toMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
