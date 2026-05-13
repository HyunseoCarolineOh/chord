// 에이전트 정의 로더.
// 검색 순서:
//   1) ~/.claude/agents/<name>.md     (글로벌, claude CLI와 공유)
//   2) <workspace_root>/.claude/agents/<name>.md   (워크스페이스 로컬)
//   3) <workspace_root>/.chord/agents/<name>.md    (legacy chord 위치)
import { fsRead, fsReadAbs, fsExistsAbs, fsHomeDir } from "./fs";
import type { AgentDef } from "../types";

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/;

// 사용자가 오늘 날짜·요일·현재 시각 등을 물을 때 LLM이 추측해서
// 틀린 요일을 답하는 일을 막기 위한 공통 지침. 모든 에이전트 systemPrompt 뒤에 붙는다.
// claude_code preset에 Bash가 이미 포함돼 있으므로 별도 도구 허용 설정은 불필요.
export const DATE_TOOL_GUIDANCE = `

## 날짜·요일 처리 규칙
사용자가 오늘 날짜, 요일, 현재 시각을 물어보면 학습 데이터로 추측하지 말고 반드시 실행 도구로 직접 조회한 결과만 답하라.
- Windows(PowerShell): \`Get-Date -Format "yyyy-MM-dd (dddd) HH:mm"\`
- macOS/Linux(Bash): \`date "+%Y-%m-%d (%A) %H:%M"\`
LLM의 날짜→요일 계산은 모듈로 산술이라 자주 틀린다. 절대 추측 금지.
`;

let cachedHome: string | null = null;
async function home(): Promise<string> {
  if (cachedHome) return cachedHome;
  cachedHome = await fsHomeDir();
  return cachedHome;
}

export async function resolveAgentPath(workspaceRoot: string, name: string): Promise<string | null> {
  const h = await home();
  const candidates = [
    `${h}/.claude/agents/${name}.md`,
    `${workspaceRoot.replace(/\\/g, "/")}/.claude/agents/${name}.md`,
    `${workspaceRoot.replace(/\\/g, "/")}/.chord/agents/${name}.md`,
  ];
  for (const p of candidates) {
    try {
      if (await fsExistsAbs(p)) return p;
    } catch {
      /* skip */
    }
  }
  return null;
}

export async function loadAgent(workspaceRoot: string, name: string): Promise<AgentDef> {
  const path = await resolveAgentPath(workspaceRoot, name);
  if (!path) {
    return {
      name,
      systemPrompt: `당신은 chord 워크스페이스의 @${name} 에이전트입니다. 사용자 요청에 도움이 되도록 답하세요.`,
    };
  }
  let raw: string;
  try {
    raw = await fsReadAbs(path);
  } catch {
    // 워크스페이스 root 기준 상대로 fallback
    try {
      const rel = path.replace(workspaceRoot.replace(/\\/g, "/"), "").replace(/^\/+/, "");
      raw = await fsRead(workspaceRoot, rel);
    } catch {
      return {
        name,
        systemPrompt: `당신은 chord 워크스페이스의 @${name} 에이전트입니다.`,
      };
    }
  }
  return parseAgentMd(name, raw);
}

export function parseAgentMd(name: string, raw: string): AgentDef {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) {
    return { name, systemPrompt: raw.trim() };
  }
  const front = m[1];
  const body = m[2].trim();

  const fields = parseSimpleYaml(front);
  return {
    name: typeof fields.name === "string" ? fields.name : name,
    description: typeof fields.description === "string" ? fields.description : undefined,
    model: typeof fields.model === "string" ? fields.model : undefined,
    tools: Array.isArray(fields.tools) ? (fields.tools as string[]) : undefined,
    systemPrompt: body,
  };
}

function parseSimpleYaml(text: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const rest = m[2].trim();
    if (rest) {
      out[key] = stripQuotes(rest);
      i++;
    } else {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const lm = lines[j].match(/^\s+-\s+(.+)$/);
        if (!lm) break;
        items.push(stripQuotes(lm[1].trim()));
        j++;
      }
      if (items.length > 0) {
        out[key] = items;
        i = j;
      } else {
        out[key] = "";
        i++;
      }
    }
  }
  return out;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
