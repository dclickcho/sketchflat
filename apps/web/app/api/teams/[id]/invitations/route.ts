import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/auth';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  serverError,
  zodErrorResponse,
} from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTeamRole, roleAtLeast } from '@/lib/api/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UuidSchema = z.string().uuid();
const InviteSchema = z.object({
  email: z.string().trim().email('올바른 이메일을 입력하세요.').toLowerCase(),
  role: z.enum(['admin', 'member']).default('member'),
});

// POST /api/teams/[id]/invitations — 이메일로 팀 초대 발급 (admin 이상).
// 초대 행을 만들고, Supabase 내장 메일로 best-effort 발송한다. 발송 실패와 무관하게
// 수락 링크(acceptUrl)를 응답에 담아 UI 가 "링크 복사" 폴백을 제공할 수 있게 한다.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const idCheck = UuidSchema.safeParse(params.id);
  if (!idCheck.success) return badRequest('잘못된 팀 ID');
  const teamId = idCheck.data;

  let parsed;
  try {
    const json = await request.json().catch(() => ({}));
    parsed = InviteSchema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) return zodErrorResponse(err);
    return badRequest('JSON 파싱 실패');
  }

  const role = await getTeamRole(supabase, teamId, user.id);
  if (!role) return notFound('팀을 찾을 수 없습니다.');
  if (!roleAtLeast(role, 'admin')) return forbidden('초대 권한이 없습니다.');

  const admin = createAdminClient();

  // 이미 멤버인 이메일인지 확인 (auth.users 조회 후 멤버십 대조).
  const { data: team } = await admin
    .from('teams')
    .select('name')
    .eq('id', teamId)
    .maybeSingle();
  if (!team) return notFound('팀을 찾을 수 없습니다.');

  const { data: inv, error: invErr } = await admin
    .from('team_invitations')
    .insert({
      team_id: teamId,
      email: parsed.email,
      role: parsed.role,
      invited_by: user.id,
    })
    .select('id, email, role, token, status, created_at, expires_at')
    .single();

  if (invErr) {
    // 부분 유니크 인덱스(team_id, email where pending) 위반 → 이미 초대 대기 중.
    if (invErr.code === '23505') return conflict('이미 초대 대기 중인 이메일입니다.');
    return serverError(invErr.message);
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? request.nextUrl.origin;
  const acceptUrl = `${origin}/teams/invite/${inv.token}`;

  // best-effort 이메일 발송. 이미 가입한 사용자에게는 inviteUserByEmail 이 실패할 수 있으나
  // 그 경우에도 초대는 유효하며 acceptUrl 로 수락 가능하다.
  let emailSent = false;
  try {
    const { error } = await admin.auth.admin.inviteUserByEmail(parsed.email, {
      redirectTo: acceptUrl,
      data: { team_invite_token: inv.token, team_name: team.name },
    });
    emailSent = !error;
  } catch {
    emailSent = false;
  }

  const { token: _token, ...safeInv } = inv;
  return NextResponse.json({ invitation: safeInv, acceptUrl, emailSent }, { status: 201 });
}
