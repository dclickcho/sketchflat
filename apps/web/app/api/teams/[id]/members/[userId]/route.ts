import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/auth';
import { badRequest, forbidden, notFound, serverError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTeamRole, roleAtLeast } from '@/lib/api/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UuidSchema = z.string().uuid();

// DELETE /api/teams/[id]/members/[userId] — 멤버 제거 또는 본인 탈퇴.
// - 본인 탈퇴: owner 는 탈퇴 불가(팀 삭제/위임 필요), 그 외 허용.
// - 타인 제거: admin 이상만, 단 owner 는 제거 불가.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; userId: string } },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const teamCheck = UuidSchema.safeParse(params.id);
  const userCheck = UuidSchema.safeParse(params.userId);
  if (!teamCheck.success || !userCheck.success) return badRequest('잘못된 ID');
  const teamId = teamCheck.data;
  const targetId = userCheck.data;

  const myRole = await getTeamRole(supabase, teamId, user.id);
  if (!myRole) return notFound('팀을 찾을 수 없습니다.');

  const isSelf = targetId === user.id;
  if (!isSelf && !roleAtLeast(myRole, 'admin'))
    return forbidden('멤버 제거 권한이 없습니다.');

  const admin = createAdminClient();
  const { data: target } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', targetId)
    .maybeSingle();
  if (!target) return notFound('해당 멤버를 찾을 수 없습니다.');

  if (target.role === 'owner')
    return forbidden('소유자는 제거할 수 없습니다. 팀을 삭제하거나 소유권을 위임하세요.');

  const { error } = await admin
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', targetId);
  if (error) return serverError(error.message);
  return NextResponse.json({ ok: true });
}
