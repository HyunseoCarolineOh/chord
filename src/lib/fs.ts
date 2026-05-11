// Tauri fs commands wrapper
import { invoke } from "@tauri-apps/api/core";

export type DirEntry = {
  name: string;
  path: string;     // root 기준 상대경로
  is_dir: boolean;
  size: number;
};

export async function fsList(root: string, rel: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("fs_list", { root, rel });
}

export async function fsRead(root: string, rel: string): Promise<string> {
  return invoke<string>("fs_read", { root, rel });
}

export async function fsWrite(root: string, rel: string, content: string): Promise<void> {
  return invoke<void>("fs_write", { root, rel, content });
}

export async function fsMove(root: string, fromRel: string, toRel: string): Promise<void> {
  return invoke<void>("fs_move", { root, fromRel, toRel });
}

export async function fsReadAbs(path: string): Promise<string> {
  return invoke<string>("fs_read_abs", { path });
}

export async function fsWriteAbs(path: string, content: string): Promise<void> {
  return invoke<void>("fs_write_abs", { path, content });
}

export async function fsHomeDir(): Promise<string> {
  return invoke<string>("fs_home_dir");
}

export async function fsExistsAbs(path: string): Promise<boolean> {
  return invoke<boolean>("fs_exists_abs", { path });
}

/** 절대경로 여부 (Windows: C:/..., POSIX: /...) */
export function isAbsolute(path: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(path) || path.startsWith("/");
}

// 파일 확장자 → CodeMirror language 식별자
export function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "html":
    case "htm":
      return "html";
    case "css":
    case "scss":
      return "css";
    case "json":
      return "json";
    case "md":
    case "mdx":
      return "markdown";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "sql":
      return "sql";
    default:
      return "plaintext";
  }
}
