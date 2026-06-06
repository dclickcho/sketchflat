import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { SketchSchema } from '@sketchflat/svg-schema';
import { requireUser } from '@/lib/api/auth';
import {
  badRequest,
  notFound,
  serverError,
  zodErrorResponse,
} from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UuidSchema = z.string().uuid();

const PatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    thumbnail_url: z.string().url().nullable().optional(),
    is_favorite: z.boolean().optional(),
    // team_id 가 있으면 해당 팀으로 이전, null 이면 개인 프로젝트로 환원.
    // RLS 가 멤버십을 강제(projects_insert_own/projects_update_own with check).
    team_id: z.string().uuid().nullable().optional(),
    // sketch는 SketchSchema로 풀 검증. 부분 업데이트는 클라이언트가 머지해서 보낸다.
    sketch: SketchSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '수정할 필드가 없습니다.' });

// GET /api/projects/[id] — 단일 프로젝트 (RLS가 본인 것만 반환).
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const idCheck = UuidSchema.safeParse(params.id);
  if (!idCheck.success) return badRequest('잘못된 프로젝트 ID');

  const { data, error } = await supabase
    .from('projects')
    .select('id, title, sketch, thumbnail_url, is_favorite, team_id, created_at, updated_at')
    .eq('id', idCheck.data)
    .maybeSingle();

  if (error) return serverError(error.message);
  if (!data) return notFound('프로젝트를 찾을 수 없습니다.');
  return NextResponse.json({ project: data });
}

// PATCH /api/projects/[id] — title / sketch / thumbnail_url 수정.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const idCheck = UuidSchema.safeParse(params.id);
  if (!idCheck.success) return badRequest('잘못된 프로젝트 ID');

  let patch;
  try {
    const json = await request.json().catch(() => ({}));
    patch = PatchSchema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) return zodErrorResponse(err);
    return badRequest('JSON 파싱 실패');
  }

  const { data, error } = await supabase
    .from('projects')
    .update(patch)
    .eq('id', idCheck.data)
    .select('id, title, sketch, thumbnail_url, is_favorite, team_id, created_at, updated_at')
    .maybeSingle();

  if (error) return serverError(error.message);
  if (!data) return notFound('프로젝트를 찾을 수 없습니다.');
  return NextResponse.json({ project: data });
}

// DELETE /api/projects/[id] — 프로젝트 삭제. RLS가 본인 것만 삭제 가능하도록 보장.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const idCheck = UuidSchema.safeParse(params.id);
  if (!idCheck.success) return badRequest('잘못된 프로젝트 ID');

  const { data, error } = await supabase
    .from('projects')
    .delete()
    .eq('id', idCheck.data)
    .select('id')
    .maybeSingle();

  if (error) return serverError(error.message);
  if (!data) return notFound('프로젝트를 찾을 수 없습니다.');
  return NextResponse.json({ ok: true });
}
