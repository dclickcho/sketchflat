import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/auth';
import { badRequest, serverError, zodErrorResponse } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateTeamSchema = z.object({
  name: z.string().trim().min(1, '팀 이름을 입력하세요.').max(100),
});

// GET /api/teams — 내가 속한 팀 목록 (역할 포함).
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const { data, error } = await supabase
    .from('team_members')
    .select('role, team:teams(id, name, created_at, updated_at)')
    .eq('user_id', user.id);

  if (error) return serverError(error.message);

  const teams = (data ?? [])
    .filter((row) => row.team)
    .map((row) => ({ ...(row.team as object), role: row.role }));
  return NextResponse.json({ teams });
}

// POST /api/teams — 팀 생성. 생성자는 owner 로 등록.
// teams/team_members INSERT 정책이 없으므로 admin(service-role) 클라이언트로 처리.
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let parsed;
  try {
    const json = await request.json().catch(() => ({}));
    parsed = CreateTeamSchema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) return zodErrorResponse(err);
    return badRequest('JSON 파싱 실패');
  }

  const admin = createAdminClient();
  const { data: team, error: teamErr } = await admin
    .from('teams')
    .insert({ name: parsed.name, created_by: user.id })
    .select('id, name, created_at, updated_at')
    .single();
  if (teamErr || !team) return serverError(teamErr?.message ?? '팀 생성 실패');

  const { error: memberErr } = await admin
    .from('team_members')
    .insert({ team_id: team.id, user_id: user.id, role: 'owner' });
  if (memberErr) {
    // 멤버 등록 실패 시 고아 팀을 남기지 않도록 롤백.
    await admin.from('teams').delete().eq('id', team.id);
    return serverError(memberErr.message);
  }

  return NextResponse.json({ team: { ...team, role: 'owner' } }, { status: 201 });
}
