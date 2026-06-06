import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/api/auth';
import { notFound } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/invitations/[token] — 토큰으로 초대 미리보기. 로그인 필요.
// team_invitations 에 토큰 조회 정책이 없으므로 admin 클라이언트로 읽는다.
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from('team_invitations')
    .select('id, team_id, email, role, status, expires_at, team:teams(name)')
    .eq('token', params.token)
    .maybeSingle();

  if (!inv) return notFound('초대를 찾을 수 없습니다.');

  const expired = new Date(inv.expires_at).getTime() < Date.now();
  const emailMatches =
    (user.email ?? '').toLowerCase() === inv.email.toLowerCase();

  return NextResponse.json({
    invitation: {
      team_name: (inv.team as { name?: string } | null)?.name ?? null,
      email: inv.email,
      role: inv.role,
      status: inv.status,
      expired,
      emailMatches,
    },
  });
}
