# chord

Discord 스타일 멀티 에이전트 워크스페이스. Tauri 데스크톱 앱.

채널마다 cwd · 도구를 분리하고 한 채널에 여러 에이전트가 `@멘션`으로 응답. 메인은 채팅, 트리·심플 에디터·Git Sync는 보조 패널.

## Phase 1 + 2 + 3 완료 기능

- **Tauri** shell + React + Vite + TypeScript
- **Sidecar Node** + `@anthropic-ai/claude-agent-sdk` + 시스템 `claude` CLI 자동 detect (API 키 불필요)
- **Supabase** ceo-staff에 `chord_*` 7테이블
- **3-pane**: 좌(채널↔트리 토글), 메인(채팅), 우(세션 첨부 파일 + Git mini)
- **세션** 명시 (`/session start | end | reopen | list`) — 컨텍스트 단위
- **@멘션** 라우팅 + 토큰 단위 스트리밍 + tool_call chip
- **트리** + DnD (세션 패널·에디터·다른 폴더)
- **CodeMirror 6** 심플 에디터 (`Ctrl+E`, save = `Ctrl+S`)
- **Git Sync** 한 버튼 (stage→commit→push) + diff + branch + log (`Ctrl+G`)
- **스레드** (메시지 `↳ thread` 버튼)
- **슬래시** `/channel`, `/agent`, `/workspace`
- **agent.md** 로더 (`.chord/agents/<name>.md` frontmatter)
- **검색** — 메시지·세션 trigram 검색 (`Ctrl+/`)
- **archived flag** — 채널·세션 archive, 사이드바 토글 (`/channel archive`, `/session archive`)
- **동시 응답** — `@a @b` 동시 호출 (Promise.all)
- **MCP 서버 슬롯** — `/channel mcp add <name> [stdio|http|sse] <command|url>`
- **Supabase Realtime** — 메시지·채널·세션·열린파일 변경 즉시 반영 (멀티 디바이스/창)
- **Git 확장** — stash save/pop/drop + rebase start/continue/abort + conflict 표시
- **VS Code bridge v2** — selection range + diagnostics 동기화

## 로컬 실행

요구: Node 20+, Rust 1.80+ (msvc), pnpm, Windows 10/11 + WebView2

```bash
pnpm install
cd sidecar && pnpm install && pnpm build && cd ..
pnpm tauri dev
```

`.env.local`에 Supabase URL/key 필요:
```
VITE_SUPABASE_URL=https://...
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

## 디렉토리

- `src/` — React frontend (UI, 라우터, lib, 컴포넌트)
- `src-tauri/` — Rust core (sidecar bridge, fs, git ops)
- `sidecar/` — Node 프로세스 (claude-agent-sdk, JSONL IPC)
- `.chord/agents/` — 에이전트 정의 (`<name>.md` frontmatter)

## 같은 폴더 옆

- `../chord-bridge-vscode/` — VS Code extension (열린 파일 메타 동기화)
- `../chord-plan.html` — 디자인 deck (검수용 슬라이드)
- `../chord-vs-vscode.md` — VS Code와 비교 문서
