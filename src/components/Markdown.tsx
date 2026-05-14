import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { openLink, stripLineSuffix } from "../lib/openers";
import { linkifyChildren, Linkified } from "./Linkified";

// 코드 블록/인라인 코드 안에서 첫 번째 파일 경로 추출.
// Linkified의 TOKEN_RE와 호환되는 패턴 — Windows abs, POSIX abs, 상대 경로 (확장자 필수).
const FILE_PATH_RE =
  /(?:[A-Za-z]:[/\\][^\s)\]<>"']*?\.[a-zA-Z][a-zA-Z0-9]{0,8}(?::\d+(?::\d+)?)?)|(?:\/[^\s)\]<>"']*?\.[a-zA-Z][a-zA-Z0-9]{0,8}(?::\d+(?::\d+)?)?)|(?:(?:\.{1,2}\/|[\w.-]+\/)[\w./\\-]*?\.[a-zA-Z][a-zA-Z0-9]{0,8}(?::\d+(?::\d+)?)?)/;

function extractFirstFilePath(text: string): string | null {
  // 트레일링 구두점 제거는 Linkified와 동일
  const m = text.match(FILE_PATH_RE);
  if (!m) return null;
  let raw = m[0];
  while (raw.length > 0 && /[.,;:!?)]$/.test(raw)) {
    if (/:\d+(?::\d+)?$/.test(raw)) break;
    raw = raw.slice(0, -1);
  }
  return raw || null;
}

type Props = {
  children: string;
  workspaceRoot?: string | null;
  onOpenFile?: (path: string, line?: number, col?: number) => void;
  onPickOption?: (label: string) => void;
};

type CardOption = { label: string; description?: string };
type Card = { question?: string; options: CardOption[] };

function parseCard(raw: string): Card | null {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") return null;
    const d = data as { question?: unknown; options?: unknown };
    if (!Array.isArray(d.options)) return null;
    const options: CardOption[] = d.options
      .map((o): CardOption | null => {
        if (typeof o === "string") return { label: o };
        if (o && typeof o === "object") {
          const oo = o as { label?: unknown; description?: unknown };
          if (typeof oo.label !== "string") return null;
          return {
            label: oo.label,
            description: typeof oo.description === "string" ? oo.description : undefined,
          };
        }
        return null;
      })
      .filter((x): x is CardOption => x !== null);
    if (options.length === 0) return null;
    return {
      question: typeof d.question === "string" ? d.question : undefined,
      options,
    };
  } catch {
    return null;
  }
}

function CardOptions({
  raw,
  onPickOption,
}: {
  raw: string;
  onPickOption?: (label: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const card = parseCard(raw);
  if (!card) {
    return <div className="chord-options-err">chord:options JSON 파싱 실패</div>;
  }
  return (
    <div className="chord-options">
      {card.question && <div className="chord-options-q">{card.question}</div>}
      <div className="chord-options-grid">
        {card.options.map((opt) => {
          const isPicked = picked === opt.label;
          return (
            <button
              key={opt.label}
              type="button"
              className={`chord-option ${isPicked ? "picked" : ""}`}
              disabled={picked !== null && !isPicked}
              onClick={() => {
                if (picked) return;
                setPicked(opt.label);
                onPickOption?.(opt.label);
              }}
            >
              <span className="opt-label">{opt.label}</span>
              {opt.description && <span className="opt-desc">{opt.description}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OpenFileButton({
  path,
  onOpenFile,
}: {
  path: string;
  onOpenFile: (p: string, line?: number, col?: number) => void;
}) {
  const { path: clean, line, col } = stripLineSuffix(path);
  return (
    <button
      type="button"
      className="code-open"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenFile(clean, line, col);
      }}
      title={`파일 열기 · ${clean}${line ? `:${line}` : ""}`}
    >
      📂 open
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function onCopy(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("clipboard write failed", err);
    }
  }
  return (
    <button
      type="button"
      className={`code-copy ${copied ? "copied" : ""}`}
      onClick={onCopy}
      title="코드 복사"
    >
      {copied ? "✓ copied" : "copy"}
    </button>
  );
}

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
};

function extractText(node: HastNode | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  if (Array.isArray(node.children)) {
    return node.children.map(extractText).join("");
  }
  return "";
}

function extractLang(node: HastNode | null | undefined): string | null {
  if (!node?.properties) return null;
  const cn = node.properties.className;
  const list = Array.isArray(cn) ? cn : typeof cn === "string" ? cn.split(/\s+/) : [];
  for (const c of list) {
    const s = String(c);
    if (s.startsWith("language-")) return s.slice("language-".length);
  }
  return null;
}

function useCtrlIndicator() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey) document.body.classList.add("chord-ctrl");
    }
    function onKeyUp(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) document.body.classList.remove("chord-ctrl");
    }
    function onBlur() {
      document.body.classList.remove("chord-ctrl");
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}

export function Markdown({ children, workspaceRoot, onOpenFile, onPickOption }: Props) {
  useCtrlIndicator();

  const linkCtx = { workspaceRoot, onOpenFile };

  function onAnchorClick(href: string | undefined) {
    return (e: ReactMouseEvent<HTMLAnchorElement>) => {
      if (!href) return;
      if (!(e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      void openLink(href, linkCtx);
    };
  }

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ node: _n, href, children, ...rest }) => (
            <a
              {...rest}
              href={href}
              className="linkable"
              title={`${href ?? ""}\nCtrl/⌘+클릭으로 열기`}
              onClick={onAnchorClick(href)}
            >
              {children}
            </a>
          ),
          pre: ({ node, children }) => {
            const hast = node as unknown as HastNode | undefined;
            const codeNode = hast?.children?.find((c) => c.tagName === "code") ?? hast?.children?.[0];
            const lang = extractLang(codeNode);
            const text = extractText(codeNode);

            if (lang === "chord:options" || lang === "chord-options") {
              return <CardOptions raw={text} onPickOption={onPickOption} />;
            }

            const firstPath = onOpenFile ? extractFirstFilePath(text) : null;

            return (
              <div className="code-wrap">
                <div className="code-actions">
                  {firstPath && onOpenFile && (
                    <OpenFileButton path={firstPath} onOpenFile={onOpenFile} />
                  )}
                  <CopyButton text={text} />
                </div>
                <pre>{children}</pre>
              </div>
            );
          },
          code: ({ node: _n, className, children, ...rest }) => {
            // 코드 블록(```) 안 code 태그는 pre가 처리하므로 className에 language-* 가 있음
            // 그 경우엔 기본 처리(highlight.js 스타일) 유지
            const isBlock = typeof className === "string" && className.includes("language-");
            if (isBlock) {
              return <code className={className} {...rest}>{children}</code>;
            }
            // 인라인 코드 — 내용이 단순 텍스트면 Linkified 처리
            if (typeof children === "string") {
              return (
                <code {...rest}>
                  <Linkified text={children} workspaceRoot={workspaceRoot} onOpenFile={onOpenFile} />
                </code>
              );
            }
            return <code {...rest}>{children}</code>;
          },
          p: ({ node: _n, children }) => <p>{linkifyChildren(children, linkCtx)}</p>,
          li: ({ node: _n, children, ...rest }) => (
            <li {...rest}>{linkifyChildren(children, linkCtx)}</li>
          ),
          td: ({ node: _n, children, ...rest }) => (
            <td {...rest}>{linkifyChildren(children, linkCtx)}</td>
          ),
          blockquote: ({ node: _n, children }) => (
            <blockquote>{linkifyChildren(children, linkCtx)}</blockquote>
          ),
          img: ({ node: _n, src, alt, ...rest }) => (
            <img
              {...rest}
              src={src}
              alt={alt ?? ""}
              loading="lazy"
              className="md-img"
              onClick={() => src && void openLink(src, linkCtx)}
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
