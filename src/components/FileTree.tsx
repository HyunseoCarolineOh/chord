import { useEffect, useState, useCallback, type DragEvent } from "react";
import { fsList, fsMove, type DirEntry } from "../lib/fs";

type Props = {
  root: string;
  onOpenFile: (path: string) => void;
  onAttachToSession?: (path: string) => void;       // 세션 패널에 drop
  onAttachToInput?: (path: string) => void;          // 입력창에 drop (App에서 callback)
};

type Node = DirEntry & { children?: Node[]; expanded?: boolean; loading?: boolean };

export function FileTree({ root, onOpenFile, onAttachToSession }: Props) {
  const [rootEntries, setRootEntries] = useState<Node[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const entries = await fsList(root, "");
      setRootEntries(entries.map((e) => ({ ...e })));
    } catch (e) {
      setError(toMsg(e));
    }
  }, [root]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggleExpand = useCallback(
    async (path: string) => {
      setRootEntries((prev) => updateNode(prev, path, (n) => ({ ...n, loading: true })));
      try {
        const children = await fsList(root, path);
        setRootEntries((prev) =>
          updateNode(prev, path, (n) => ({
            ...n,
            children: children.map((c) => ({ ...c })),
            expanded: true,
            loading: false,
          })),
        );
      } catch (e) {
        setError(toMsg(e));
        setRootEntries((prev) => updateNode(prev, path, (n) => ({ ...n, loading: false })));
      }
    },
    [root],
  );

  const collapse = useCallback((path: string) => {
    setRootEntries((prev) => updateNode(prev, path, (n) => ({ ...n, expanded: false })));
  }, []);

  return (
    <div className="tree">
      <div className="tree-header">
        <span className="tree-root-label">{shortRoot(root)}</span>
        <button className="tree-refresh" onClick={() => void reload()} title="reload">
          ↻
        </button>
      </div>
      {error && <div className="tree-error">{error}</div>}
      <ul className="tree-list">
        {rootEntries.map((n) => (
          <TreeNode
            key={n.path}
            node={n}
            depth={0}
            root={root}
            onToggle={toggleExpand}
            onCollapse={collapse}
            onOpenFile={onOpenFile}
            onAttachToSession={onAttachToSession}
            onAfterMove={() => void reload()}
          />
        ))}
      </ul>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  root,
  onToggle,
  onCollapse,
  onOpenFile,
  onAttachToSession,
  onAfterMove,
}: {
  node: Node;
  depth: number;
  root: string;
  onToggle: (path: string) => void;
  onCollapse: (path: string) => void;
  onOpenFile: (path: string) => void;
  onAttachToSession?: (path: string) => void;
  onAfterMove: () => void;
}) {
  function onClick() {
    if (node.is_dir) {
      if (node.expanded) onCollapse(node.path);
      else onToggle(node.path);
    } else {
      onOpenFile(node.path);
    }
  }

  function onDragStart(e: DragEvent<HTMLLIElement>) {
    e.dataTransfer.setData(
      "application/x-chord-item",
      JSON.stringify({ path: node.path, isDir: node.is_dir }),
    );
    e.dataTransfer.setData("application/x-chord-file", node.path);
    e.dataTransfer.setData("text/plain", node.path);
    e.dataTransfer.effectAllowed = "copyMove";
  }

  function onDragOver(e: DragEvent<HTMLLIElement>) {
    if (!node.is_dir) return;
    if (e.dataTransfer.types.includes("application/x-chord-file")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }

  async function onDrop(e: DragEvent<HTMLLIElement>) {
    if (!node.is_dir) return;
    const from = e.dataTransfer.getData("application/x-chord-file");
    if (!from || from === node.path) return;
    const fileName = from.split("/").pop() ?? from;
    const to = node.path ? `${node.path}/${fileName}` : fileName;
    if (from === to) return;
    e.preventDefault();
    try {
      await fsMove(root, from, to);
      onAfterMove();
    } catch (err) {
      console.error("fsMove failed", err);
    }
  }

  return (
    <>
      <li
        className={`tree-item ${node.is_dir ? "dir" : "file"}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onClick={onClick}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDoubleClick={() => !node.is_dir && onAttachToSession?.(node.path)}
        title={node.is_dir ? `${node.name}/` : `${node.name} (더블클릭 → 세션에 첨부)`}
      >
        <span className="tree-twisty">{node.is_dir ? (node.expanded ? "▾" : "▸") : " "}</span>
        <span className="tree-icon">{fileIcon(node.name, node.is_dir, node.expanded)}</span>
        <span className="tree-name">{node.name}</span>
      </li>
      {node.is_dir && node.expanded && node.children && (
        <ul className="tree-list">
          {node.children.map((c) => (
            <TreeNode
              key={c.path}
              node={c}
              depth={depth + 1}
              root={root}
              onToggle={onToggle}
              onCollapse={onCollapse}
              onOpenFile={onOpenFile}
              onAttachToSession={onAttachToSession}
              onAfterMove={onAfterMove}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function updateNode(
  list: Node[],
  path: string,
  patch: (n: Node) => Node,
): Node[] {
  return list.map((n) => {
    if (n.path === path) return patch(n);
    if (n.children) return { ...n, children: updateNode(n.children, path, patch) };
    return n;
  });
}

function shortRoot(root: string): string {
  const parts = root.split(/[/\\]/);
  return parts.slice(-2).join("/") || root;
}

function fileIcon(name: string, isDir: boolean, expanded?: boolean): string {
  if (isDir) return expanded ? "📂" : "📁";
  // 특수 파일명
  if (/^package(-lock)?\.json$/.test(name)) return "📦";
  if (/^pnpm-lock\.yaml$/.test(name)) return "📦";
  if (name === "Cargo.toml" || name === "Cargo.lock") return "🦀";
  if (/^tsconfig.*\.json$/.test(name)) return "⚙️";
  if (/^vite\.config\./.test(name)) return "⚡";
  if (name === ".gitignore" || name === ".gitattributes") return "🔧";
  if (name === ".env" || /^\.env\./.test(name)) return "🔐";
  if (/^readme\.md$/i.test(name)) return "📖";
  if (/^license/i.test(name)) return "📜";
  if (/^dockerfile$/i.test(name) || name === "docker-compose.yml") return "🐳";
  if (name === "Makefile" || name === "makefile") return "🛠️";
  // 확장자
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts": case "tsx": case "mts": case "cts": return "🟦";
    case "js": case "jsx": case "mjs": case "cjs": return "🟨";
    case "rs": return "🦀";
    case "py": return "🐍";
    case "go": return "🐹";
    case "java": case "kt": return "☕";
    case "rb": return "💎";
    case "php": return "🐘";
    case "swift": return "🦉";
    case "html": case "htm": return "🌐";
    case "css": case "scss": case "sass": case "less": return "🎨";
    case "json": case "json5": case "jsonc": return "📋";
    case "md": case "mdx": case "markdown": return "🅼";
    case "yaml": case "yml": return "📄";
    case "toml": case "ini": case "cfg": case "conf": return "⚙️";
    case "sql": return "🗃️";
    case "lock": return "🔒";
    case "png": case "jpg": case "jpeg": case "gif": case "webp": case "ico": case "bmp": return "🖼️";
    case "svg": return "🖋️";
    case "mp4": case "mov": case "avi": case "mkv": case "webm": return "🎬";
    case "mp3": case "wav": case "flac": case "ogg": return "🎵";
    case "pdf": return "📕";
    case "zip": case "tar": case "gz": case "rar": case "7z": return "📦";
    case "sh": case "bash": case "zsh": case "fish": return "💻";
    case "ps1": case "psm1": return "💠";
    case "bat": case "cmd": return "⌨️";
    case "vue": return "💚";
    case "svelte": return "🟧";
    case "c": case "h": return "🔵";
    case "cpp": case "cc": case "cxx": case "hpp": return "🟪";
    case "cs": return "🟩";
    case "txt": case "log": return "📃";
    case "csv": case "tsv": case "xlsx": return "📊";
    default: return "📄";
  }
}

function toMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
