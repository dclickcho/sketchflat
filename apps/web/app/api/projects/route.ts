import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/auth';
import { badRequest, serverError, zodErrorResponse } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateProjectSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

// POST /api/projects — 빈 프로젝트 생성. sketch는 null로 시작.
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  let parsed;
  try {
    const json = await request.json().catch(() => ({}));
    parsed = CreateProjectSchema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) return zodErrorResponse(err);
    return badRequest('JSON 파싱 실패');
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({ user_id: user.id, title: parsed.title ?? '제목 없음' })
    .select('id, title, sketch, thumbnail_url, is_favorite, created_at, updated_at')
    .single();

  if (error || !data) return serverError(error?.message ?? '프로젝트 생성 실패');
  return NextResponse.json({ project: data }, { status: 201 });
}

// GET /api/projects — 본인 프로젝트 목록 (최신순). 페이지네이션은 추후.
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { data, error } = await supabase
    .from('projects')
    .select('id, title, thumbnail_url, is_favorite, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) return serverError(error.message);
  return NextResponse.json({ projects: data ?? [] });
}
