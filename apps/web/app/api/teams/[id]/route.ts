import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/auth';
import {
  badRequest,
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
const PatchSchema = z.object({ name: z.string().trim().min(1).max(100) });

// GET /api/teams/[id] — 팀 상세: 본인 역할, 멤버 목록, (admin 한정) 대기 중 초대.
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const idCheck = UuidSchema.safeParse(params.id);
  if (!idCheck.success) return badRequest('잘못된 팀 ID');
  const teamId = idCheck.data;

  const role = await getTeamRole(supabase, teamId, user.id);
  if (!role) return notFound('팀을 찾을 수 없습니다.');

  const { data: team } = await supabase
    .from('teams')
    .select('id, name, created_at, updated_at')
    .eq('id', teamId)
    .maybeSingle();
  if (!team) return notFound('팀을 찾을 수 없습니다.');

  const { data: members } = await supabase
    .from('team_members')
    .select('user_id, role, created_at')
    .eq('team_id', teamId)
    .order('created_at', { ascending: true });

  // 멤버 이메일은 auth.users 에 있으므로 admin 클라이언트로 보강한다.
  const admin = createAdminClient();
  const memberList = await Promise.all(
    (members ?? []).map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      return {
        user_id: m.user_id,
        role: m.role,
        email: data.user?.email ?? null,
        created_at: m.created_at,
      };
    }),
  );

  let invitations: unknown[] = [];
  if (roleAtLeast(role, 'admin')) {
    const { data: inv } = await supabase
      .from('team_invitations')
      .select('id, email, role, status, created_at, expires_at')
      .eq('team_id', teamId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    invitations = inv ?? [];
  }

  return NextResponse.json({ team: { ...team, role }, members: memberList, invitations });
}

// PATCH /api/teams/[id] — 팀 이름 변경 (admin 이상).
export async function PATCH(
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
    parsed = PatchSchema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) return zodErrorResponse(err);
    return badRequest('JSON 파싱 실패');
  }

  const role = await getTeamRole(supabase, teamId, user.id);
  if (!role) return notFound('팀을 찾을 수 없습니다.');
  if (!roleAtLeast(role, 'admin')) return forbidden('팀 이름 변경 권한이 없습니다.');

  const { data, error } = await supabase
    .from('teams')
    .update({ name: parsed.name })
    .eq('id', teamId)
    .select('id, name, created_at, updated_at')
    .maybeSingle();
  if (error) return serverError(error.message);
  if (!data) return notFound('팀을 찾을 수 없습니다.');
  return NextResponse.json({ team: { ...data, role } });
}

// DELETE /api/teams/[id] — 팀 삭제 (owner 만). cascade 로 멤버/초대/팀 프로젝트 연결이 정리된다.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const idCheck = UuidSchema.safeParse(params.id);
  if (!idCheck.success) return badRequest('잘못된 팀 ID');
  const teamId = idCheck.data;

  const role = await getTeamRole(supabase, teamId, user.id);
  if (!role) return notFound('팀을 찾을 수 없습니다.');
  if (role !== 'owner') return forbidden('팀 삭제는 소유자만 가능합니다.');

  const { error } = await supabase.from('teams').delete().eq('id', teamId);
  if (error) return serverError(error.message);
  return NextResponse.json({ ok: true });
}
