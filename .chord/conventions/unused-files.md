# 안 쓰는 파일 판단 기준 — chord

housekeeper 에이전트가 "더 이상 안 쓰는 파일"을 결정할 때 이 룰을 그대로 따른다. 모호하면 **삭제하지 말고 보고만** 한다.

## 진입점 (이 그래프에 도달하지 않으면 안 씀)

- **프론트엔드**: `src/main.tsx` → `App.tsx` → … 모든 컴포넌트·lib
- **HTML**: `index.html` (vite entry)
- **Tauri**: `src-tauri/src/main.rs` (Rust) + `src-tauri/tauri.conf.json` (sidecar 명시)
- **Sidecar**: `sidecar/*.{ts,js,mjs}` 중 `package.json`이나 `tauri.conf.json`에 참조되는 것
- **Trading server**: `trading-server/` 자체 진입점
- **Scripts**: `package.json`의 `scripts` 키에 등록된 것 + `*.config.*` 에서 참조
- **Vite**: `vite.config.ts`에서 참조하는 plugin·alias
- **Public**: `public/` 안의 파일은 URL 직접 참조 가능하므로 사용 여부 자동 판단 불가 → 항상 보존 (사용자가 명시 삭제 요청한 경우만)

## "확실히 안 쓴다" — 자동 삭제 제안 OK

다음 **모두** 만족할 때만:

1. `.bak`, `.tmp`, `.old`, `~` 접미·접두 파일
2. 또는 `src/`, `src-tauri/src/`, `sidecar/`, `trading-server/` 내 코드 파일인데:
   - `grep -r`로 파일 basename 검색해도 import·require·include 없음
   - 진입점 그래프 어디서도 도달 안 됨
   - 최근 30일 git 변경 없음 (`git log --since="30 days ago" -- <path>` 결과 비어있음)
3. 위 디렉토리 안 빈 폴더

## "거의 안 쓴다" — 사용자 확인 후 제안

1. 같은 기능 두 버전 공존: `Foo.tsx` + `Foo.old.tsx`, `oldFoo.ts` + `foo.ts` 등
2. 6개월 이상 git 변경 없고 import도 없는 파일
3. `docs/` 안 mockup·plan HTML 중 의사결정 끝나 더 안 쓸 것 같은 것 (사용자에게 묻고 결정)
4. `scripts/` 안 1회성으로 보이는 것 (`migrate-*.ts`, `seed-*.ts`)

## 절대 삭제 금지 (보고도 하지 말 것)

- `README.md`, `LICENSE`, `*.config.*` (vite·tsconfig·tauri·package), lockfile (`pnpm-lock.yaml`)
- `.env*`, `.gitignore`, `.vscode/`, `.git/`
- `node_modules/`, `dist/`, `build/` 안의 모든 파일
- `.chord/agents/*`, `.chord/conventions/*` — 사용자가 명시 요청해야만
- `public/` 안 파일 — URL 직접 참조 가능
- 사용자가 직접 작성 중인 파일 (`git status` 에 modified 또는 untracked로 나오는 것)

## 작업 전 항상 확인

1. `git status` — 사용자 in-progress 변경이 있는지
2. `git ls-files <path>` — git이 추적하는 파일인지 (untracked 파일은 사용자가 작업 중일 가능성)
3. 삭제 후보가 import되는 곳이 정말 0개인지 `grep -rn "<basename>" src/ src-tauri/ sidecar/ scripts/`로 재확인
4. 동적 import·동적 require·string 기반 참조도 확인 (`React.lazy(() => import("..."))`, `await import("...")`, `require("...")`)

## 출력 형식 (housekeeper가 보고할 때)

```
=== 자동 삭제 제안 ===
- <path>  사유: <한 줄>
- ...

=== 확인 필요 ===
- <path>  사유: <한 줄>  / 같이 검토할 짝: <path>
- ...

=== 이동 제안 (file-location.md 기준) ===
- <현재 경로> → <제안 경로>  사유: <한 줄>
- ...

=== 실행 계획 ===
1. git status 확인
2. <삭제·이동 명령 묶음>
3. import 경로 갱신 (필요 시 파일·라인 명시)
```

사용자가 OK 하면 실행, 아니면 보고만으로 마친다.
