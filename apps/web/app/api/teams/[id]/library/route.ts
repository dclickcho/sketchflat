import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/auth';
import { badRequest, notFound, serverError, zodErrorResponse } from '@/lib/api/errors';
import { getTeamRole } from '@/lib/api/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'team-library';
const UuidSchema = z.string().uuid();
const CreateAssetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60),
  svg: z.string().trim().min(1).max(2_000_000),
});

// GET /api/teams/[id]/library — 팀 라이브러리 에셋 목록 (서명 URL 포함).
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

  const { data: rows, error } = await supabase
    .from('team_library_assets')
    .select('id, name, category, storage_path, created_at')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false });
  if (error) return serverError(error.message);

  const assets = await Promise.all(
    (rows ?? []).map(async (a) => {
      const { data } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(a.storage_path, 3600);
      return { ...a, url: data?.signedUrl ?? null };
    }),
  );
  return NextResponse.json({ assets });
}

// POST /api/teams/[id]/library — SVG 에셋 추가. 멤버면 누구나 가능(스토리지/테이블 RLS가 강제).
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
    parsed = CreateAssetSchema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) return zodErrorResponse(err);
    return badRequest('JSON 파싱 실패');
  }

  const role = await getTeamRole(supabase, teamId, user.id);
  if (!role) return notFound('팀을 찾을 수 없습니다.');

  const assetId = crypto.randomUUID();
  const storagePath = `${teamId}/${assetId}.svg`;

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, parsed.svg, { contentType: 'image/svg+xml', upsert: false });
  if (uploadErr) return serverError(`업로드 실패: ${uploadErr.message}`);

  const { data, error } = await supabase
    .from('team_library_assets')
    .insert({
      id: assetId,
      team_id: teamId,
      name: parsed.name,
      category: parsed.category,
      storage_path: storagePath,
      created_by: user.id,
    })
    .select('id, name, category, storage_path, created_at')
    .single();
  if (error || !data) {
    // 메타 삽입 실패 시 업로드한 파일을 정리한다.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return serverError(error?.message ?? '에셋 등록 실패');
  }

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);
  return NextResponse.json(
    { asset: { ...data, url: signed?.signedUrl ?? null } },
    { status: 201 },
  );
}
