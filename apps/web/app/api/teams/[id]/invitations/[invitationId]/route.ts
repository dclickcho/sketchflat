import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/auth';
import { badRequest, forbidden, notFound, serverError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTeamRole, roleAtLeast } from '@/lib/api/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UuidSchema = z.string().uuid();

// DELETE /api/teams/[id]/invitations/[invitationId] — 대기 중 초대 철회 (admin 이상).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; invitationId: string } },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const teamCheck = UuidSchema.safeParse(params.id);
  const invCheck = UuidSchema.safeParse(params.invitationId);
  if (!teamCheck.success || !invCheck.success) return badRequest('잘못된 ID');

  const role = await getTeamRole(supabase, teamCheck.data, user.id);
  if (!role) return notFound('팀을 찾을 수 없습니다.');
  if (!roleAtLeast(role, 'admin')) return forbidden('초대 철회 권한이 없습니다.');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('team_invitations')
    .update({ status: 'revoked' })
    .eq('id', invCheck.data)
    .eq('team_id', teamCheck.data)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) return serverError(error.message);
  if (!data) return notFound('철회할 초대를 찾을 수 없습니다.');
  return NextResponse.json({ ok: true });
}
