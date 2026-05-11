// 링크 / 파일 경로 열기 헬퍼.
// - http(s) URL → Tauri opener (시스템 브라우저)
// - 절대/상대 파일 경로 → 콜백(인앱 에디터 탭)이 있으면 그쪽으로, 없으면 OS 기본 앱
import { openUrl, openPath } from "@tauri-apps/plugin-opener";
import { isAbsolute } from "./fs";

export type OpenContext = {
  workspaceRoot?: string | null;
  onOpenFile?: (path: string, line?: number, col?: number) => void;
};

function isHttp(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function isFileScheme(s: string): boolean {
  return /^file:\/\//i.test(s);
}

function isMailto(s: string): boolean {
  return /^mailto:/i.test(s);
}

/** "path:42:5" 또는 "path:42" 또는 "path" 형태에서 path / line / col 분리.
 *  Windows 드라이브 문자(`C:`)는 보존된다 — line은 반드시 마지막 :digit 그룹. */
export function stripLineSuffix(s: string): { path: string; line?: number; col?: number } {
  const m = s.match(/^(.+?)(?::(\d+)(?::(\d+))?)?$/);
  if (!m) return { path: s };
  return {
    path: m[1],
    line: m[2] ? Number(m[2]) : undefined,
    col: m[3] ? Number(m[3]) : undefined,
  };
}

export async function openLink(href: string, ctx: OpenContext = {}): Promise<void> {
  if (!href) return;

  if (isHttp(href) || isMailto(href)) {
    try {
      await openUrl(href);
    } catch (e) {
      console.error("openUrl failed", href, e);
    }
    return;
  }

  if (isFileScheme(href)) {
    const raw = href.replace(/^file:\/\//i, "");
    const { path, line, col } = stripLineSuffix(raw);
    return tryOpenFile(path, ctx, line, col);
  }

  const { path, line, col } = stripLineSuffix(href);

  // 절대 / 상대 / workspace-relative 모두 파일 시도
  if (
    isAbsolute(path) ||
    path.startsWith("./") ||
    path.startsWith("../") ||
    ctx.workspaceRoot
  ) {
    return tryOpenFile(path, ctx, line, col);
  }

  // 마지막 fallback — OS 기본 앱
  try {
    await openPath(path);
  } catch (e) {
    console.error("openPath failed", path, e);
  }
}

async function tryOpenFile(
  path: string,
  ctx: OpenContext,
  line?: number,
  col?: number,
): Promise<void> {
  if (ctx.onOpenFile && (isAbsolute(path) || ctx.workspaceRoot)) {
    ctx.onOpenFile(path, line, col);
    return;
  }
  try {
    await openPath(path);
  } catch (e) {
    console.error("openPath failed", path, e);
  }
}
