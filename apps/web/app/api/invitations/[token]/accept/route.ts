import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/api/auth';
import { badRequest, forbidden, notFound, serverError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/invitations/[token]/accept — 초대 수락. 로그인 필요.
// 보안: 로그인한 사용자의 이메일이 초대 이메일과 일치해야 한다(링크 무단 공유 차단).
export async function POST(
  _request: NextRequest,
  { params }: { params: { token: string } },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from('team_invitations')
    .select('id, team_id, email, role, status, expires_at')
    .eq('token', params.token)
    .maybeSingle();

  if (!inv) return notFound('초대를 찾을 수 없습니다.');
  if (inv.status !== 'pending') return badRequest('이미 처리된 초대입니다.');
  if (new Date(inv.expires_at).getTime() < Date.now())
    return badRequest('만료된 초대입니다.');
  if ((user.email ?? '').toLowerCase() !== inv.email.toLowerCase())
    return forbidden('초대받은 이메일 계정으로 로그인해야 수락할 수 있습니다.');

  // 멤버 등록 (이미 멤버면 무시) + 초대 상태 갱신.
  const { error: memberErr } = await admin
    .from('team_members')
    .upsert(
      { team_id: inv.team_id, user_id: user.id, role: inv.role },
      { onConflict: 'team_id,user_id', ignoreDuplicates: true },
    );
  if (memberErr) return serverError(memberErr.message);

  await admin
    .from('team_invitations')
    .update({ status: 'accepted' })
    .eq('id', inv.id);

  return NextResponse.json({ ok: true, team_id: inv.team_id });
}
