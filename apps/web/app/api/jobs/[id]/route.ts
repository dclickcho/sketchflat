import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/auth';
import { badRequest, notFound, serverError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UuidSchema = z.string().uuid();

// 클라이언트가 sketches 버킷에서 직접 SVG를 읽을 수 있도록 발급하는 signed URL의 수명.
// 폴링이 종료된 직후 한 번만 사용 → 짧게 잡아도 충분. 만료 후에는 재조회 시 새 URL 발급.
const SKETCH_URL_TTL_SECONDS = 60 * 10; // 10분

// GET /api/jobs/[id] — 클라이언트 폴링용. RLS가 본인 job만 반환.
// status === 'succeeded' 이고 output_sketch_url(=sketches bucket의 객체 경로)이 있으면
// signed URL을 함께 돌려준다 — 클라이언트가 SVG를 직접 fetch / canvas 렌더링하기 위함.
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const idCheck = UuidSchema.safeParse(params.id);
  if (!idCheck.success) return badRequest('잘못된 job ID');

  const { data, error } = await supabase
    .from('jobs')
    .select(
      'id, kind, status, project_id, output_sketch_url, output_image_url, error_message, created_at, updated_at',
    )
    .eq('id', idCheck.data)
    .maybeSingle();

  if (error) return serverError(error.message);
  if (!data) return notFound('job을 찾을 수 없습니다.');

  // sketch 경로가 있으면 signed URL로 변환. 실패해도 job 자체는 응답한다 (UI에서 경로만이라도 표시 가능).
  // sketches 경로 규약은 '<user_id>/<job_id>.svg' (webhook에서 그렇게 작성). 본인 폴더가 아닌 경로는 무시.
  let sketchSignedUrl: string | null = null;
  let sketchUrlExpiresAt: string | null = null;
  let sketchUrlError: string | null = null;

  if (data.output_sketch_url) {
    const path = data.output_sketch_url;
    if (!path.startsWith(`${user.id}/`)) {
      // 데이터 정합성 이슈 — RLS가 객체 접근은 막아주지만 일단 로그만 남기고 무시.
      console.warn('[jobs/[id]] output_sketch_url not in user folder', {
        job_id: data.id,
        user_id: user.id,
        path,
      });
    } else {
      const signed = await supabase.storage
        .from('sketches')
        .createSignedUrl(path, SKETCH_URL_TTL_SECONDS);
      if (signed.data?.signedUrl) {
        sketchSignedUrl = signed.data.signedUrl;
        sketchUrlExpiresAt = new Date(
          Date.now() + SKETCH_URL_TTL_SECONDS * 1000,
        ).toISOString();
      } else {
        sketchUrlError = signed.error?.message ?? 'signed URL 생성 실패';
      }
    }
  }

  return NextResponse.json({
    job: {
      ...data,
      // 추가 파생 필드. raw output_sketch_url(=bucket-relative path)은 그대로 유지해서 디버깅 가능.
      sketch_signed_url: sketchSignedUrl,
      sketch_signed_url_expires_at: sketchUrlExpiresAt,
      sketch_signed_url_error: sketchUrlError,
    },
  });
}
