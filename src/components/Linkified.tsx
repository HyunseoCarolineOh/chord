import { Fragment, type MouseEvent as ReactMouseEvent } from "react";
import { openLink, stripLineSuffix } from "../lib/openers";

type Props = {
  text: string;
  workspaceRoot?: string | null;
  onOpenFile?: (path: string, line?: number, col?: number) => void;
};

// URL · 파일 경로 (옵션: :line, :line:col) 동시 매칭.
// 아이디어: 한 정규식에서 capture group으로 분기. 매칭되는 토큰은:
//   - http(s) URL
//   - file:// URL
//   - Windows 절대 (C:/...  또는  C:\...)
//   - POSIX 절대 ( /usr/... )
//   - 상대 ( ./... · ../... · 디렉터리/파일.확장자 )
//   - 위 모두 끝에 :line 또는 :line:col 허용
const FILE_EXT = "(?:[a-zA-Z][a-zA-Z0-9]{0,8})";

const TOKEN_RE = new RegExp(
  [
    // 1) URL (http/https/file)
    "(https?:\\/\\/[^\\s)\\]<>\"']+)",
    // 2) Windows absolute path with optional :L:C
    `([A-Za-z]:[/\\\\][^\\s)\\]<>"']*?\\.${FILE_EXT}(?::\\d+(?::\\d+)?)?)`,
    // 3) POSIX absolute path with optional :L:C
    `(/[^\\s)\\]<>"']*?\\.${FILE_EXT}(?::\\d+(?::\\d+)?)?)`,
    // 4) Relative path (./, ../, or contains slash and has extension)
    `((?:\\.{1,2}/|[\\w.-]+/)[\\w./\\\\-]*?\\.${FILE_EXT}(?::\\d+(?::\\d+)?)?)`,
  ].join("|"),
  "g",
);

type Match = { start: number; end: number; raw: string; kind: "url" | "path" };

function findMatches(text: string): Match[] {
  const out: Match[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text))) {
    const [whole, urlG, winG, posixG, relG] = m;
    if (!whole) continue;
    if (urlG) {
      out.push({ start: m.index, end: m.index + whole.length, raw: whole, kind: "url" });
    } else if (winG || posixG || relG) {
      // 트레일링 구두점 잘라내기 (".", ",", ")")
      let raw = whole;
      let endTrim = 0;
      while (raw.length > 0 && /[.,;:!?)]$/.test(raw)) {
        // 단 :digit 형식이면 (path:42) 잘라내지 않음
        if (/:\d+(?::\d+)?$/.test(raw)) break;
        raw = raw.slice(0, -1);
        endTrim++;
      }
      out.push({
        start: m.index,
        end: m.index + whole.length - endTrim,
        raw,
        kind: "path",
      });
    }
  }
  return out;
}

export function Linkified({ text, workspaceRoot, onOpenFile }: Props) {
  if (!text) return null;
  const matches = findMatches(text);
  if (matches.length === 0) return <>{text}</>;

  function handleClick(raw: string, kind: "url" | "path") {
    return (e: ReactMouseEvent<HTMLSpanElement>) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      if (kind === "path") {
        const { path, line, col } = stripLineSuffix(raw);
        if (onOpenFile && path) {
          onOpenFile(path, line, col);
          return;
        }
      }
      void openLink(raw, { workspaceRoot, onOpenFile: onOpenFile ? (p) => onOpenFile(p) : undefined });
    };
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((mt, i) => {
    if (mt.start > cursor) parts.push(<Fragment key={`t${i}`}>{text.slice(cursor, mt.start)}</Fragment>);
    parts.push(
      <span
        key={`m${i}`}
        className="linkable"
        title={`${mt.raw}\nCtrl/⌘+클릭으로 ${mt.kind === "url" ? "링크 열기" : "파일 열기"}`}
        onClick={handleClick(mt.raw, mt.kind)}
      >
        {mt.raw}
      </span>,
    );
    cursor = mt.end;
  });
  if (cursor < text.length) parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
  return <>{parts}</>;
}

export function linkifyChildren(
  children: React.ReactNode,
  ctx: { workspaceRoot?: string | null; onOpenFile?: (path: string, line?: number, col?: number) => void },
): React.ReactNode {
  if (children == null) return children;
  if (typeof children === "string") {
    return <Linkified text={children} workspaceRoot={ctx.workspaceRoot} onOpenFile={ctx.onOpenFile} />;
  }
  if (Array.isArray(children)) {
    return children.map((c, i) => {
      if (typeof c === "string") {
        return <Linkified key={i} text={c} workspaceRoot={ctx.workspaceRoot} onOpenFile={ctx.onOpenFile} />;
      }
      return c;
    });
  }
  return children;
}
