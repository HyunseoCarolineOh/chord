// 채팅 첨부물 — 클립보드 paste / 드래그한 이미지를 Supabase storage(chord-attachments)에 업로드.
import { supabase } from "./supabase";

const BUCKET = "chord-attachments";
const MAX_BYTES = 5 * 1024 * 1024;

export type UploadResult = {
  url: string;
  path: string;
};

function extFromMime(mime: string): string {
  const m: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };
  return m[mime] ?? "bin";
}

function makePath(mime: string): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 10);
  return `${yyyy}/${mm}/${Date.now()}-${rand}.${extFromMime(mime)}`;
}

export async function uploadAttachment(file: File | Blob, mime?: string): Promise<UploadResult> {
  const ct = mime ?? (file instanceof File ? file.type : "application/octet-stream");
  if (file.size > MAX_BYTES) {
    throw new Error(`파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB) — 5MB 제한`);
  }
  const path = makePath(ct);
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: ct,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/** 메시지 본문에 포함된 chord-attachments URL을 추출. hard-delete 시 storage 정리에 사용. */
export function extractAttachmentPaths(content: string): string[] {
  const out: string[] = [];
  // public URL 패턴: .../storage/v1/object/public/chord-attachments/<path>
  const re = /\/storage\/v1\/object\/public\/chord-attachments\/([^\s)"']+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push(decodeURIComponent(m[1]));
  }
  return out;
}

export async function deleteAttachments(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) {
    console.warn("attachment cleanup failed:", error.message);
  }
}
