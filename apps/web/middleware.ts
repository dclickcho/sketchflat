import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isAllowedEmail } from '@/lib/auth/allowlist';

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // 매 요청마다 세션 토큰 갱신 — Server Component에서 getUser()/getSession()이 동작하려면 필수.
  const { data } = await supabase.auth.getUser();

  // 개발 중 접근 제한: 허용 목록에 없는 계정은(이메일/비번·Google 무관) 즉시 로그아웃 후 차단.
  // 베타 오픈 시 이 블록과 allowlist.ts 를 제거.
  const user = data.user;
  if (user && !isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    if (url.pathname !== '/login') {
      url.pathname = '/login';
      url.search = `?mode=login&error=${encodeURIComponent('접근 권한이 없는 계정입니다.')}`;
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    // 정적 파일 / 이미지 / 파비콘 / API 라우트 일부 제외
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
