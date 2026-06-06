import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/auth';
import { badRequest, notFound, serverError } from '@/lib/api/errors';
import { getTeamRole } from '@/lib/api/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'team-library';
const UuidSchema = z.string().uuid();

// DELETE /api/teams/[id]/library/[assetId] — 팀 라이브러리 에셋 삭제 (팀 멤버).
// 스토리지 객체부터 삭제하고 메타 행을 지운다. 스토리지 삭제 실패는 무시(고아 파일은 추후 GC).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; assetId: string } },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const teamCheck = UuidSchema.safeParse(params.id);
  const assetCheck = UuidSchema.safeParse(params.assetId);
  if (!teamCheck.success || !assetCheck.success) return badRequest('잘못된 ID');
  const teamId = teamCheck.data;
  const assetId = assetCheck.data;

  const role = await getTeamRole(supabase, teamId, user.id);
  if (!role) return notFound('팀을 찾을 수 없습니다.');

  const { data: asset } = await supabase
    .from('team_library_assets')
    .select('id, storage_path')
    .eq('id', assetId)
    .eq('team_id', teamId)
    .maybeSingle();
  if (!asset) return notFound('에셋을 찾을 수 없습니다.');

  await supabase.storage.from(BUCKET).remove([asset.storage_path]);

  const { error } = await supabase
    .from('team_library_assets')
    .delete()
    .eq('id', assetId)
    .eq('team_id', teamId);
  if (error) return serverError(error.message);
  return NextResponse.json({ ok: true });
}
