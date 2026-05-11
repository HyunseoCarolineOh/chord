/**
 * 입력 라우터 — 사용자 텍스트를 한 번 보고 어떻게 처리할지 결정.
 *
 * 결과 종류:
 *   - slash:   chord 내부 슬래시 커맨드 (/session 등) → 로컬 액션, SDK 호출 안 함
 *   - mention: @name 1+개 포함 → user 메시지 INSERT + 각 에이전트 호출
 *   - plain:   둘 다 아님 → user 메시지 INSERT만, 응답 없음
 *
 * Claude Code 스킬 슬래시(/make-slide 등)는 chord가 가로채지 않고 raw 텍스트가
 * 그대로 에이전트(Claude Code SDK)에 전달되도록 plain/mention 흐름으로 분기.
 */

import { CLAUDE_CODE_SKILL_SET } from "./slashCatalog";

export type Routed =
  | { kind: "slash"; command: string; args: string[]; raw: string }
  | { kind: "mention"; agents: string[]; cleanText: string; raw: string }
  | { kind: "plain"; raw: string };

const MENTION_RE = /@([a-zA-Z][a-zA-Z0-9_-]*)/g;

export function route(input: string): Routed {
  const raw = input.trim();
  if (!raw) return { kind: "plain", raw };

  if (raw.startsWith("/")) {
    const tokens = raw.slice(1).split(/\s+/);
    const [command, ...args] = tokens;
    if (command && CLAUDE_CODE_SKILL_SET.has(command)) {
      const agents = extractMentions(raw);
      if (agents.length > 0) return { kind: "mention", agents, cleanText: raw, raw };
      return { kind: "plain", raw };
    }
    return { kind: "slash", command: command ?? "", args, raw };
  }

  const agents = extractMentions(raw);
  if (agents.length > 0) {
    return { kind: "mention", agents, cleanText: raw, raw };
  }

  return { kind: "plain", raw };
}

function extractMentions(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}
