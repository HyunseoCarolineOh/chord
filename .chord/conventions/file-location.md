# 파일 위치 컨벤션 — chord

새 파일을 만들거나 기존 파일을 옮길 때 이 룰을 따른다. housekeeper 에이전트가 정리 기준으로 참조한다.

## 디렉토리 역할

| 경로 | 역할 | 두는 것 | 두지 않는 것 |
|---|---|---|---|
| `src/` | 프론트엔드 코드 루트 | `App.tsx`, `App.css`, `main.tsx`, `types.ts`, `vite-env.d.ts` 만 | 그 외 컴포넌트·라이브러리는 하위로 |
| `src/components/` | React 컴포넌트 (`.tsx`) | UI 컴포넌트, hooks-with-jsx | 순수 비즈니스 로직, 상수, 타입 |
| `src/lib/` | 비즈니스 로직·헬퍼 (`.ts`) | supabase 헬퍼, 라우터, 상수, 도메인 함수 | JSX 포함 모듈 |
| `src/assets/` | 번들에 포함되는 정적 자원 | 작은 이미지/폰트 (import해서 쓰는 것) | URL로 직접 노출되는 자원 |
| `src-tauri/` | Tauri Rust 백엔드 | Rust 소스, `tauri.conf.json` | TS/JS 파일 |
| `sidecar/` | Node sidecar (Claude SDK runner) | Node 스크립트 | 프론트 코드 |
| `trading-server/` | 별도 서비스 | 그 서비스만 | 다른 도메인 파일 |
| `scripts/` | 빌드·유틸·1회성 스크립트 | `*.mjs`, `*.ts`, `*.sh` | 런타임 임포트되는 라이브러리 |
| `public/` | URL로 직접 노출되는 정적 자원 | `favicon`, 정적 HTML | 코드에서 import하는 자원 (그건 `src/assets/`) |
| `docs/` | 사람이 보는 문서 | `.md`, `.html` (mockup·plan deck), 다이어그램 | 런타임 코드, 컨벤션 (그건 `.chord/conventions/`) |
| `.chord/agents/` | 에이전트 정의 | `<name>.md` (frontmatter 필수) | 보조 문서 |
| `.chord/conventions/` | 프로젝트 컨벤션 | `.md` 룰 문서 | 일반 사용자용 가이드 (그건 `docs/`) |
| `dist/` | 빌드 산출물 | 자동 생성된 것만 | 손으로 만든 파일 일체 |

## 명명 규칙

- 컴포넌트: `PascalCase.tsx` (예: `ThreadView.tsx`)
- 라이브러리·훅·유틸: `camelCase.ts` (예: `slashCatalog.ts`, `useFoo.ts`)
- 스타일: 컴포넌트와 같은 이름의 `.css` (예: `Editor.css`) 또는 `App.css`로 통합
- 문서: `kebab-case.md` (예: `file-location.md`)

## 새 파일 만들 때 룰

1. **JSX가 들어가면** → `src/components/`
2. **JSX 없이 비즈니스 로직만** → `src/lib/<feature>.ts`
3. **이미 같은 feature의 파일이 있으면** → 같은 폴더 안에 모아 두기
4. **여러 컴포넌트가 한 기능을 이룬다면** → `src/components/<feature>/` 서브폴더로
5. **일회성 mockup/계획 HTML** → `docs/`
6. **컨벤션·룰 문서** → `.chord/conventions/`
7. **빌드 시 한 번만 도는 스크립트** → `scripts/`

## 옮길 때 룰

- import 경로가 깨지면 일괄 갱신 (Grep으로 import 패턴 확인 후 Edit replace_all)
- 같은 폴더 안에서의 이름 변경은 `git mv` 권장 (history 유지)
- 폴더 자체를 옮길 때는 그 안의 모든 파일 import 경로 일괄 점검

## 예외

- `README.md`, `LICENSE`, `*.config.*`, lockfile, `.env*`, `.gitignore` 은 항상 루트 유지
- `node_modules/`, `dist/`, `build/` 안의 파일은 직접 수정·이동 금지
