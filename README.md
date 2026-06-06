# SketchFlat 스케치팩

AI 기반 의류 도식화(플랫 스케치) 자동 생성·편집 웹 서비스.

패션 디자이너가 러프 스케치나 실물 사진을 업로드하면, 생성형 AI가 의류 도식화 이미지를 만들고
Quiver Arrow API가 이를 벡터(SVG)로 변환해, 웹 캔버스에서 바로 편집·관리할 수 있습니다.

## 처리 흐름

```
사용자 업로드(이미지)
  → Replicate (생성형 이미지 모델) : 도식화 PNG 생성
  → Webhook 수신 → Quiver Arrow API : PNG → SVG 벡터화
  → Supabase Storage(sketches) 저장 → job succeeded
  → 웹 캔버스 에디터에서 SVG 미리보기 + 벡터 편집
```

## 기술 스택

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Konva/react-konva, paper.js, Zustand(+zundo/immer), Zod
- **Backend**: Next.js API Routes (REST), Supabase Auth(SSR 쿠키 세션)
- **외부 연동**: Replicate(생성형 이미지), Quiver Arrow API(이미지 벡터화)
- **DBMS**: Supabase (PostgreSQL) — `profiles / projects / jobs / library_assets / teams ...`
- **Web Storage**: localStorage(에디터 자동저장 draft·UI 설정), sessionStorage(진행 중 생성 작업 상태)
- **인프라**: Docker(멀티스테이지 standalone) + Nginx 리버스 프록시, GitHub Actions CI, Vercel 배포

## 모노레포 구조

```
apps/web              # Next.js 앱 (UI + API Routes)
packages/svg-schema   # 공용 SVG/Sketch 스키마 (Zod)
packages/parts-library# 부품 SVG 라이브러리
docker/               # nginx.conf
supabase/             # DB 마이그레이션
```

## 로컬 개발

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # 값 채우기
pnpm --filter @sketchflat/web dev              # http://localhost:3000
```

필요한 환경변수는 `apps/web/.env.example` 참고 (Supabase / Replicate / Quiver).

## Docker로 실행 (Nginx 리버스 프록시)

```bash
docker compose up --build       # http://localhost (Nginx :80 → web :3000)
```

## 배포

- **CD**: Vercel (main 브랜치 푸시 시 자동 배포). Root Directory = `apps/web`.
- **CI**: GitHub Actions(`.github/workflows/ci.yml`) — lint · typecheck · build 검증.

Vercel 환경변수에 `apps/web/.env.example`의 키들을 설정하고, `supabase/` 마이그레이션을 대상
Supabase 프로젝트에 적용해야 합니다.
