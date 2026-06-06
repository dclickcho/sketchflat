// SSR 빌드 시점에 paper/dist/paper-core 의 자리 — paper.js 는 클라이언트 전용 에디터 액션
// (dividePaths) 안에서만 호출되므로 서버 코드 경로에서는 평가될 일이 없다. 빈 stub 으로 두면
// next build 의 webpack 정적 분석이 paper-core → node/self.js → jsdom 추적에 들어가는
// 것을 막을 수 있다.
module.exports = {};
