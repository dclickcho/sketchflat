const path = require('path');
const webpack = require('webpack');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Docker 이미지를 가볍게 — standalone 출력(.next/standalone)에 런타임 최소 의존성만 번들.
  output: 'standalone',
  transpilePackages: ['@sketchflat/svg-schema', '@sketchflat/parts-library'],
  experimental: {
    typedRoutes: true,
    // 모노레포 루트 기준 파일 트레이싱 — 워크스페이스 패키지를 standalone 에 포함 (Next 14.2).
    outputFileTracingRoot: path.join(__dirname, '../../'),
    // 클라 Router Cache 가 force-dynamic 페이지(홈 프로젝트 목록 등)를 뒤로가기
    // 시 stale 하게 재사용 → 생성 직후 프로젝트가 목록에서 사라져 보이던 문제.
    // dynamic:0 → 동적 라우트는 네비게이션마다 항상 재요청(stale 재사용 금지).
    staleTimes: { dynamic: 0 },
  },
  webpack: (config, { isServer }) => {
    // paper-core 는 self 가 없으면 paper/dist/node/self.js → jsdom/canvas 로 fallback.
    // 클라이언트 번들에서는 self 가 있어 도달하지 않는 분기이지만 webpack 이 정적 분석으로
    // require trace 를 따라가 jsdom 을 못 찾고 빌드 실패한다. jsdom/canvas 모듈 자체를 무시.
    config.plugins = [
      ...(config.plugins ?? []),
      new webpack.IgnorePlugin({ resourceRegExp: /^(jsdom|canvas)$/ }),
    ];
    if (isServer) {
      // SSR 빌드 그래프에 paper-core 가 들어오는 것까지 막는다. 에디터(클라이언트 전용)에서만
      // dividePaths 가 호출되므로 server 에서는 paper 가 호출되지 않음 — 빈 stub 으로 충분.
      config.resolve = config.resolve ?? {};
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        'paper/dist/paper-core': path.resolve(__dirname, './lib/paper-stub.js'),
      };
    }
    return config;
  },
};

module.exports = nextConfig;
