// 슬래시 명령어 정적 카탈로그 — 자동완성 dropdown에서 사용.
// 실제 실행 로직은 slash.ts.

export type SlashCommand = {
  label: string;     // 자동완성에 표시되는 본문 ("/session start")
  insert: string;    // 입력창에 삽입할 텍스트 (자리표시자 포함 가능)
  desc: string;      // 한 줄 설명
  kind?: "chord" | "skill";  // skill: Claude Code 스킬 — chord가 가로채지 않고 에이전트에 그대로 전달
};

// Claude Code 스킬 이름 — router.ts에서 chord 슬래시로 가로채지 않기 위해 export.
// 여기 이름과 일치하는 /xxx 입력은 plain/mention 흐름으로 흘러 에이전트(SDK) 프롬프트에 그대로 들어감.
export const CLAUDE_CODE_SKILLS = [
  "make-slide",
  "linkedin",
  "publish",
  "update-config",
  "keybindings-help",
  "simplify",
  "fewer-permission-prompts",
  "loop",
  "schedule",
  "claude-api",
  "init",
  "review",
  "security-review",
] as const;

export const CLAUDE_CODE_SKILL_SET: ReadonlySet<string> = new Set(CLAUDE_CODE_SKILLS);

export const SLASH_COMMANDS: SlashCommand[] = [
  { label: "/session start <name>", insert: "/session start ", desc: "새 세션 시작", kind: "chord" },
  { label: "/session end", insert: "/session end", desc: "현재 세션 종료", kind: "chord" },
  { label: "/session reopen <name>", insert: "/session reopen ", desc: "닫힌 세션 다시 열기", kind: "chord" },
  { label: "/session list", insert: "/session list", desc: "세션 목록", kind: "chord" },
  { label: "/session archive", insert: "/session archive", desc: "현재 세션 보관", kind: "chord" },

  { label: "/channel create <name>", insert: "/channel create ", desc: "새 채널 생성", kind: "chord" },
  { label: "/channel cwd <path>", insert: "/channel cwd ", desc: "채널 작업 디렉토리 변경", kind: "chord" },
  { label: "/channel allow <Tool1,Tool2>", insert: "/channel allow ", desc: "허용 도구 설정", kind: "chord" },
  { label: "/channel agents add <name>", insert: "/channel agents add ", desc: "채널에 에이전트 추가", kind: "chord" },
  { label: "/channel agents remove <name>", insert: "/channel agents remove ", desc: "채널에서 에이전트 제거", kind: "chord" },
  { label: "/channel archive", insert: "/channel archive", desc: "채널 보관 토글", kind: "chord" },
  { label: "/channel mcp add <name> stdio <command>", insert: "/channel mcp add ", desc: "MCP 서버 추가", kind: "chord" },
  { label: "/channel mcp remove <name>", insert: "/channel mcp remove ", desc: "MCP 서버 제거", kind: "chord" },
  { label: "/channel mcp list", insert: "/channel mcp list", desc: "MCP 서버 목록", kind: "chord" },

  { label: "/agent list", insert: "/agent list", desc: "에이전트 정의 위치 안내", kind: "chord" },

  { label: "/debate <주제>", insert: "/debate ", desc: "페르소나 자동 체이닝 토론 시작", kind: "chord" },
  { label: "/debate end", insert: "/debate end", desc: "현재 채널의 진행 중 토론 종료", kind: "chord" },
  { label: "/debate status", insert: "/debate status", desc: "진행 중 토론 상태 보기", kind: "chord" },

  { label: "/workspace create <name> <path>", insert: "/workspace create ", desc: "워크스페이스 생성", kind: "chord" },
  { label: "/workspace list", insert: "/workspace list", desc: "워크스페이스 목록", kind: "chord" },

  // ===== Claude Code 스킬 (에이전트에 그대로 전달) =====
  { label: "/make-slide <topic>", insert: "/make-slide ", desc: "HTML 프레젠테이션 생성", kind: "skill" },
  { label: "/linkedin <topic>", insert: "/linkedin ", desc: "LinkedIn 포스트 작성", kind: "skill" },
  { label: "/publish", insert: "/publish ", desc: "GitHub 공개 저장소 퍼블리시", kind: "skill" },
  { label: "/simplify", insert: "/simplify", desc: "변경 코드 정리·단순화", kind: "skill" },
  { label: "/review", insert: "/review", desc: "PR 리뷰", kind: "skill" },
  { label: "/security-review", insert: "/security-review", desc: "현재 브랜치 보안 리뷰", kind: "skill" },
  { label: "/claude-api", insert: "/claude-api ", desc: "Claude API/SDK 코드 빌드·디버그", kind: "skill" },
  { label: "/init", insert: "/init", desc: "CLAUDE.md 초기화 (코드베이스 문서)", kind: "skill" },
  { label: "/update-config", insert: "/update-config ", desc: "Claude Code settings.json 변경", kind: "skill" },
  { label: "/keybindings-help", insert: "/keybindings-help ", desc: "키보드 단축키 커스터마이즈 안내", kind: "skill" },
  { label: "/fewer-permission-prompts", insert: "/fewer-permission-prompts", desc: "권한 프롬프트 줄이기 allowlist", kind: "skill" },
  { label: "/loop <interval> <cmd>", insert: "/loop ", desc: "주기적 반복 실행", kind: "skill" },
  { label: "/schedule", insert: "/schedule ", desc: "예약 작업(cron) 생성·관리", kind: "skill" },
];

export function filterSlash(query: string, limit = 8): SlashCommand[] {
  const q = query.toLowerCase();
  if (!q) return SLASH_COMMANDS.slice(0, limit);
  return SLASH_COMMANDS
    .filter((c) => c.label.toLowerCase().includes(q))
    .slice(0, limit);
}
