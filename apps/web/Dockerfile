# SketchFlat web — 멀티스테이지 빌드 (Next.js standalone, pnpm + turbo 모노레포)
# 빌드 컨텍스트는 모노레포 루트(.). docker-compose 가 context: . 로 호출한다.

# ── 1) 의존성 설치 (전체 워크스페이스) ──────────────────────────────
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app
# 워크스페이스 매니페스트 + 락파일만 먼저 복사 → 레이어 캐시 활용.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/svg-schema/package.json packages/svg-schema/package.json
COPY packages/parts-library/package.json packages/parts-library/package.json
RUN pnpm install --frozen-lockfile

# ── 2) 빌드 ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @sketchflat/web build

# ── 3) 런타임 (standalone) ─────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# standalone 출력은 server.js + 최소 node_modules 를 포함. public/.next/static 은 별도 복사.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
# standalone 서버 진입점 (모노레포라 apps/web 하위에 생성됨).
CMD ["node", "apps/web/server.js"]
