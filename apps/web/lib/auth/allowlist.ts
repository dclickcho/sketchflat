// 개발 중 접근 제한 — 여기 등록된 이메일만 로그인/사용 가능.
// 베타 오픈 시 이 파일과 호출부(미들웨어·login actions)를 제거하면 전체 개방된다.
//
// ALLOWED_EMAILS 환경변수(쉼표 구분)로 덮어쓸 수 있다. 미설정 시 아래 기본값 사용.
const DEFAULT_ALLOWED = ['dclickcho10@gmail.com'];

const allowed = (process.env.ALLOWED_EMAILS ?? DEFAULT_ALLOWED.join(','))
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowed.includes(email.toLowerCase());
}
