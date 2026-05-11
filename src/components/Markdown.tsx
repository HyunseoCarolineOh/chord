import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { openLink } from "../lib/openers";
import { linkifyChildren } from "./Linkified";

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
        remarkPlugins={[remarkGfm]}
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

            return (
              <div className="code-wrap">
                <CopyButton text={text} />
                <pre>{children}</pre>
              </div>
            );
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
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
