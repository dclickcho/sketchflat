import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/auth';
import { badRequest, serverError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UuidSchema = z.string().uuid();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// GET /api/jobs — 본인 job 목록. 대시보드 / 진행상태 패널용 가벼운 응답.
// signed URL은 비용이 들기 때문에 목록에는 포함하지 않는다 — 단건 조회(/api/jobs/[id])에서만 발급.
//
// 쿼리 파라미터:
//   - project_id: 특정 프로젝트의 job만 (UUID)
//   - status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled' (반복 허용 시 추후)
//   - limit: 1~100, 기본 20
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const url = new URL(request.url);

  let projectId: string | undefined;
  const rawProjectId = url.searchParams.get('project_id');
  if (rawProjectId) {
    const check = UuidSchema.safeParse(rawProjectId);
    if (!check.success) return badRequest('잘못된 project_id');
    projectId = check.data;
  }

  let status: string | undefined;
  const rawStatus = url.searchParams.get('status');
  if (rawStatus) {
    const allowed = ['pending', 'processing', 'succeeded', 'failed', 'canceled'];
    if (!allowed.includes(rawStatus)) return badRequest('잘못된 status');
    status = rawStatus;
  }

  let limit = DEFAULT_LIMIT;
  const rawLimit = url.searchParams.get('limit');
  if (rawLimit) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1) return badRequest('잘못된 limit');
    limit = Math.min(n, MAX_LIMIT);
  }

  let query = supabase
    .from('jobs')
    .select(
      'id, kind, status, project_id, output_sketch_url, output_image_url, error_message, created_at, updated_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (projectId) query = query.eq('project_id', projectId);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return serverError(error.message);
  return NextResponse.json({ jobs: data ?? [] });
}
