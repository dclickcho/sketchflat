import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/auth';
import { badRequest, serverError, zodErrorResponse } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  IMAGE_TO_SKETCH_MODEL,
  ReplicateError,
  buildImageToSketchInput,
  buildWebhookUrl,
  createPrediction,
} from '@/lib/replicate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JobKindSchema = z.enum(['image_to_sketch', 'sketch_to_image', 'vectorize']);

const ImageToSketchInputSchema = z.object({
  // uploads 버킷 내 객체 경로 (예: '<user_id>/<uuid>.jpg'). presign 라우트가 돌려준 path 그대로.
  source_path: z.string().min(1),
  prompt: z.string().min(1).max(1000).optional(),
  aspect_ratio: z.string().min(1).max(20).optional(),
});

const GenerateSchema = z.object({
  kind: JobKindSchema,
  project_id: z.string().uuid().optional(),
  // kind별로 모양이 다름. image_to_sketch는 ImageToSketchInputSchema로 다시 좁힌다.
  input: z.record(z.unknown()).default({}),
});

// 업로드된 사진을 Replicate가 가져갈 수 있도록 짧은 수명의 signed URL로 변환.
// uploads 버킷은 private — public URL은 발급되지 않으므로 signed URL이 필수.
// 만료를 webhook 처리 여유까지 길게 잡는다 (Replicate 큐 대기 + 모델 실행 + Arrow 호출 합산).
const SOURCE_URL_TTL_SECONDS = 60 * 60; // 1시간

// POST /api/generate — jobs 행 생성 → Replicate 비동기 prediction 발사 → replicate_id 저장 후 202 응답.
// webhook이 도착하면 별도 핸들러가 status를 succeeded/failed로 갱신한다.
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  let parsed;
  try {
    const json = await request.json().catch(() => ({}));
    parsed = GenerateSchema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) return zodErrorResponse(err);
    return badRequest('JSON 파싱 실패');
  }

  // 1) jobs 행을 먼저 만든다 — Replicate 호출이 실패해도 추적 가능하게.
  const insert = await supabase
    .from('jobs')
    .insert({
      user_id: user.id,
      project_id: parsed.project_id ?? null,
      kind: parsed.kind,
      status: 'pending',
      input: parsed.input,
    })
    .select('id')
    .single();

  if (insert.error || !insert.data) {
    return serverError(insert.error?.message ?? 'job 생성 실패');
  }
  const jobId = insert.data.id as string;

  // 2) image_to_sketch만 현재 Replicate로 라우팅. 나머지 kind는 후속 단계에서 추가.
  if (parsed.kind !== 'image_to_sketch') {
    return NextResponse.json({ job_id: jobId }, { status: 202 });
  }

  const admin = createAdminClient();

  const inputCheck = ImageToSketchInputSchema.safeParse(parsed.input);
  if (!inputCheck.success) {
    await markJobFailed(admin, jobId, 'image_to_sketch input 검증 실패');
    return zodErrorResponse(inputCheck.error);
  }

  // 3) uploads 버킷 객체에 대한 signed URL 발급. RLS는 본인 폴더만 통과하므로 sanity check.
  const { source_path, prompt, aspect_ratio } = inputCheck.data;
  if (!source_path.startsWith(`${user.id}/`)) {
    await markJobFailed(admin, jobId, 'source_path 권한 오류');
    return badRequest('source_path가 본인 폴더가 아닙니다');
  }

  const signed = await supabase.storage
    .from('uploads')
    .createSignedUrl(source_path, SOURCE_URL_TTL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    await markJobFailed(admin, jobId, signed.error?.message ?? 'signed URL 생성 실패');
    return serverError(signed.error?.message ?? 'signed URL 생성 실패');
  }

  // 4) Replicate prediction 생성. 실패는 jobs 행에 기록하고 502를 돌려준다 (사용자 재시도 가능).
  try {
    const prediction = await createPrediction({
      model: IMAGE_TO_SKETCH_MODEL,
      input: buildImageToSketchInput({
        sourceImageUrl: signed.data.signedUrl,
        prompt,
        aspectRatio: aspect_ratio,
      }),
      webhook: buildWebhookUrl(jobId),
      webhookEvents: ['completed'],
    });

    // RLS UPDATE 정책이 일반 클라이언트를 막으므로 service_role 클라이언트로 갱신.
    const update = await admin
      .from('jobs')
      .update({ replicate_id: prediction.id, status: 'processing' })
      .eq('id', jobId);
    if (update.error) {
      // 이미 Replicate에는 발사됨 — webhook이 replicate_id로 다시 매칭하지 못하면 stuck job 정리 cron이 처리.
      return serverError(`replicate_id 저장 실패: ${update.error.message}`);
    }

    return NextResponse.json(
      { job_id: jobId, replicate_id: prediction.id },
      { status: 202 },
    );
  } catch (err) {
    const message =
      err instanceof ReplicateError
        ? `Replicate 호출 실패 (${err.status})`
        : err instanceof Error
          ? err.message
          : 'Replicate 호출 실패';
    await markJobFailed(admin, jobId, message);
    return NextResponse.json(
      { error: { code: 'replicate_error', message } },
      { status: 502 },
    );
  }
}

type AdminClient = ReturnType<typeof createAdminClient>;

// jobs.UPDATE는 RLS 정책상 일반 클라이언트에서 막혀 있어 service_role 전용.
// webhook 핸들러도 동일 패턴 (service_role로 갱신).
async function markJobFailed(
  admin: AdminClient,
  jobId: string,
  message: string,
): Promise<void> {
  await admin
    .from('jobs')
    .update({ status: 'failed', error_message: message.slice(0, 500) })
    .eq('id', jobId);
}
