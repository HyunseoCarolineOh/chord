// 파일 댓글 영속화 — workspace root 의 .chord/comments.json 에 저장.
// Google Docs 스타일 인라인 댓글: 선택한 텍스트 fragment + 앞/뒤 컨텍스트로 anchor 잡고
// 파일이 편집돼도 fragment를 다시 찾아 위치 재계산.
import { invoke } from "@tauri-apps/api/core";
import type { FileComment, CommentAnchor } from "../types";

const STORE_REL = ".chord/comments.json";
const CTX_LEN = 32;

type Store = {
  version: 1;
  comments: FileComment[];
};

const EMPTY: Store = { version: 1, comments: [] };

async function readRaw(root: string): Promise<string | null> {
  try {
    return await invoke<string>("fs_read", { root, rel: STORE_REL });
  } catch {
    return null;
  }
}

async function writeRaw(root: string, content: string): Promise<void> {
  await invoke<void>("fs_write", { root, rel: STORE_REL, content });
}

function parse(raw: string | null): Store {
  if (!raw) return { ...EMPTY };
  try {
    const obj = JSON.parse(raw) as Partial<Store>;
    if (!Array.isArray(obj.comments)) return { ...EMPTY };
    return { version: 1, comments: obj.comments as FileComment[] };
  } catch {
    return { ...EMPTY };
  }
}

export async function loadComments(root: string): Promise<FileComment[]> {
  const store = parse(await readRaw(root));
  return store.comments;
}

export async function saveComments(root: string, comments: FileComment[]): Promise<void> {
  const store: Store = { version: 1, comments };
  await writeRaw(root, JSON.stringify(store, null, 2));
}

export async function loadCommentsForFile(root: string, filePath: string): Promise<FileComment[]> {
  const all = await loadComments(root);
  return all.filter((c) => c.file_path === filePath);
}

export type AddCommentInput = {
  file_path: string;
  anchor: CommentAnchor;
  body: string;
  author: string;
  thread_id?: string | null;
  session_id?: string | null;
};

export async function addComment(root: string, input: AddCommentInput): Promise<FileComment> {
  const now = new Date().toISOString();
  const c: FileComment = {
    id: crypto.randomUUID(),
    file_path: input.file_path,
    anchor: input.anchor,
    body: input.body,
    author: input.author,
    thread_id: input.thread_id ?? null,
    session_id: input.session_id ?? null,
    status: "open",
    created_at: now,
    resolved_at: null,
  };
  const all = await loadComments(root);
  all.push(c);
  await saveComments(root, all);
  return c;
}

export async function resolveComment(root: string, id: string): Promise<void> {
  const all = await loadComments(root);
  const idx = all.findIndex((c) => c.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], status: "resolved", resolved_at: new Date().toISOString() };
  await saveComments(root, all);
}

export async function reopenComment(root: string, id: string): Promise<void> {
  const all = await loadComments(root);
  const idx = all.findIndex((c) => c.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], status: "open", resolved_at: null };
  await saveComments(root, all);
}

export async function deleteComment(root: string, id: string): Promise<void> {
  const all = await loadComments(root);
  await saveComments(root, all.filter((c) => c.id !== id));
}

/** 선택 텍스트와 그 앞/뒤 컨텍스트를 잡아 CommentAnchor 생성. */
export function makeAnchor(fullText: string, selectionStart: number, selectionEnd: number): CommentAnchor {
  const quote = fullText.slice(selectionStart, selectionEnd);
  const prefix = fullText.slice(Math.max(0, selectionStart - CTX_LEN), selectionStart);
  const suffix = fullText.slice(selectionEnd, Math.min(fullText.length, selectionEnd + CTX_LEN));
  return { quote, prefix, suffix };
}

/** 현재 파일 내용에서 anchor 위치 재계산.
 *  1) prefix+quote+suffix 정확 매칭 → 가장 강한 신호
 *  2) prefix+quote 매칭
 *  3) quote+suffix 매칭
 *  4) quote 단독 첫 매칭
 *  하나도 없으면 null (orphaned). */
export type AnchorMatch = {
  start: number;
  end: number;
  /** 얼마나 신뢰할만한가 — exact: prefix+quote+suffix, partial: 한쪽만, weak: quote만 */
  confidence: "exact" | "partial" | "weak";
};

export function resolveAnchor(text: string, anchor: CommentAnchor): AnchorMatch | null {
  if (!anchor.quote) return null;

  // 1) prefix+quote+suffix
  if (anchor.prefix || anchor.suffix) {
    const full = anchor.prefix + anchor.quote + anchor.suffix;
    const i = text.indexOf(full);
    if (i >= 0) {
      const start = i + anchor.prefix.length;
      return { start, end: start + anchor.quote.length, confidence: "exact" };
    }
  }
  // 2) prefix+quote
  if (anchor.prefix) {
    const pq = anchor.prefix + anchor.quote;
    const i = text.indexOf(pq);
    if (i >= 0) {
      const start = i + anchor.prefix.length;
      return { start, end: start + anchor.quote.length, confidence: "partial" };
    }
  }
  // 3) quote+suffix
  if (anchor.suffix) {
    const qs = anchor.quote + anchor.suffix;
    const i = text.indexOf(qs);
    if (i >= 0) return { start: i, end: i + anchor.quote.length, confidence: "partial" };
  }
  // 4) quote 단독
  const i = text.indexOf(anchor.quote);
  if (i >= 0) return { start: i, end: i + anchor.quote.length, confidence: "weak" };

  return null;
}

/** offset → CodeMirror 친화 line/col 계산 (1-based line, 0-based col) */
export function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped);
  const line = (before.match(/\n/g)?.length ?? 0) + 1;
  const lastNl = before.lastIndexOf("\n");
  const col = lastNl < 0 ? clamped : clamped - lastNl - 1;
  return { line, col };
}
