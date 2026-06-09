import { type NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { vectorizeImage, ArrowError } from '@/lib/arrow';

// Replicate webhook: 결과 수신 → output_image_url 저장 → Quiver(Arrow)로 즉시 벡터화 →
// sketches 버킷에 SVG 업로드 → status=succeeded → 200 반환.
// (이전엔 status=vectorizing 후 cron+v6 워커가 처리했으나, Quiver 동기 호출로 단순화.)
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

type ReplicatePayload = {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: unknown;
  error: string | null;
  logs: string | null;
};

// Replicate webhook은 항상 200 응답을 받아야 재시도가 멈춘다.
// 우리 측 처리 실패는 jobs.error_message에 기록 후 200을 돌려준다.
// 401(서명 불일치)과 400(파싱 실패)만 비-2xx로 응답해 비정상 호출을 차단.
export async function POST(request: NextRequest) {
  const raw = await request.text();

  const verify = verifySignature(request, raw);
  if (!verify.ok) {
    // 401 사유를 로그로 남겨 시크릿 불일치/미설정 등을 즉시 진단 가능하게 한다.
    console.warn(`[replicate webhook] 서명 검증 실패 (401) — reason=${verify.reason}`);
    return new Response(verify.reason, { status: 401 });
  }

  let payload: ReplicatePayload;
  try {
    payload = JSON.parse(raw) as ReplicatePayload;
  } catch {
    return new Response('잘못된 JSON', { status: 400 });
  }

  const url = new URL(request.url);
  const jobIdHint = url.searchParams.get('job');

  const admin = createAdminClient();

  // 1) jobs 행 식별. job_id 쿼리 우선 — 없으면 replicate_id로 조회.
  const lookup = jobIdHint
    ? await admin
        .from('jobs')
        .select('id, user_id, project_id, status, replicate_id, created_at')
        .eq('id', jobIdHint)
        .maybeSingle()
    : await admin
        .from('jobs')
        .select('id, user_id, project_id, status, replicate_id, created_at')
        .eq('replicate_id', payload.id)
        .maybeSingle();

  if (lookup.error || !lookup.data) {
    // 알 수 없는 job — 재시도해도 매칭 안 됨. 200으로 끝낸다.
    console.warn('[replicate webhook] job not found', { jobIdHint, replicate_id: payload.id });
    return new Response('ok', { status: 200 });
  }
  const job = lookup.data;

  // 2) replicate_id 검증 — 쿼리 힌트가 다른 prediction의 결과를 받지 못하게.
  if (job.replicate_id && job.replicate_id !== payload.id) {
    console.warn('[replicate webhook] replicate_id mismatch', {
      job_id: job.id,
      job_replicate_id: job.replicate_id,
      payload_id: payload.id,
    });
    return new Response('ok', { status: 200 });
  }

  // 3) 멱등성 — 이미 종료 상태면 재처리 금지 (Replicate가 동일 webhook을 재발사할 수 있음).
  if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled') {
    return new Response('ok', { status: 200 });
  }

  // 4) Replicate 측 실패 — Arrow 호출 없이 그대로 기록.
  if (payload.status !== 'succeeded') {
    await admin
      .from('jobs')
      .update({
        status: payload.status === 'canceled' ? 'canceled' : 'failed',
        error_message: (payload.error ?? `Replicate status=${payload.status}`).toString().slice(0, 500),
      })
      .eq('id', job.id);
    return new Response('ok', { status: 200 });
  }

  // 5) output → 이미지 URL 1개 추출. flux 계열은 보통 string 또는 string[].
  const imageUrl = pickImageUrl(payload.output);
  if (!imageUrl) {
    await admin
      .from('jobs')
      .update({ status: 'failed', error_message: 'Replicate output에 이미지 URL 없음' })
      .eq('id', job.id);
    return new Response('ok', { status: 200 });
  }

  // 6) output_image_url 저장 → Quiver(Arrow)로 SVG 변환 → sketches 버킷 업로드 → succeeded.
  const jobCreatedAt = new Date(lookup.data.created_at ?? 0).getTime();
  const replicateSec = ((Date.now() - jobCreatedAt) / 1000).toFixed(1);
  console.log(`[timing] replicate webhook arrived — job=${job.id} replicate_elapsed=${replicateSec}s`);

  // 원본 PNG를 먼저 저장 — 벡터화가 실패해도 결과 이미지는 점검 가능.
  await admin
    .from('jobs')
    .update({ status: 'vectorizing', output_image_url: imageUrl })
    .eq('id', job.id);

  // Quiver Arrow API로 PNG → SVG 동기 변환. Arrow는 webhook/polling 미제공이라
  // 이 핸들러(maxDuration=60) 한 사이클 안에서 끝낸다.
  try {
    const { svg } = await vectorizeImage({ imageUrl });

    // sketches 버킷 규약: '<user_id>/<job_id>.svg' (jobs/[id] 라우트가 이 경로로 signed URL 발급).
    const sketchPath = `${job.user_id}/${job.id}.svg`;
    const upload = await admin.storage
      .from('sketches')
      .upload(sketchPath, svg, { contentType: 'image/svg+xml', upsert: true });
    if (upload.error) {
      await admin
        .from('jobs')
        .update({
          status: 'failed',
          error_message: `SVG 업로드 실패: ${upload.error.message}`.slice(0, 500),
        })
        .eq('id', job.id);
      console.error(`[vectorize] upload failed — job=${job.id} reason=${upload.error.message}`);
      return new Response('ok', { status: 200 });
    }

    await admin
      .from('jobs')
      .update({ status: 'succeeded', output_sketch_url: sketchPath })
      .eq('id', job.id);
    console.log(`[vectorize] done via Quiver — job=${job.id} bytes=${svg.length}`);
  } catch (err) {
    const message =
      err instanceof ArrowError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Quiver 벡터화 실패';
    await admin
      .from('jobs')
      .update({ status: 'failed', error_message: `[arrow] ${message}`.slice(0, 500) })
      .eq('id', job.id);
    console.error(`[vectorize] failed — job=${job.id} reason=${message}`);
  }

  return new Response('ok', { status: 200 });
}

function pickImageUrl(output: unknown): string | null {
  if (typeof output === 'string') return output;
  if (Array.isArray(output) && typeof output[0] === 'string') return output[0];
  if (output && typeof output === 'object') {
    // 일부 모델은 { image: 'url' } 형태로도 반환.
    const obj = output as Record<string, unknown>;
    if (typeof obj.image === 'string') return obj.image;
    if (typeof obj.url === 'string') return obj.url;
  }
  return null;
}

// Standard Webhooks (svix) 호환 서명 검증. Replicate는 이 스킴을 따른다.
//   webhook-id, webhook-timestamp, webhook-signature 헤더
//   서명 = base64(HMAC_SHA256("<id>.<ts>.<body>", secretBytes))
//   webhook-signature는 "v1,sig" 항목을 공백 구분으로 여러 개 가질 수 있음.
function verifySignature(
  request: NextRequest,
  rawBody: string,
): { ok: true } | { ok: false; reason: string } {
  const secretRaw = process.env.REPLICATE_WEBHOOK_SECRET;
  if (!secretRaw) {
    // 개발 편의: 시크릿 미설정 시 검증 스킵 + 로그. 프로덕션 배포 전 반드시 설정해야 함.
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, reason: 'REPLICATE_WEBHOOK_SECRET 미설정' };
    }
    console.warn('[replicate webhook] REPLICATE_WEBHOOK_SECRET 없음 — 서명 검증 생략 (dev 전용)');
    return { ok: true };
  }

  const id = request.headers.get('webhook-id');
  const ts = request.headers.get('webhook-timestamp');
  const sigHeader = request.headers.get('webhook-signature');
  if (!id || !ts || !sigHeader) {
    return { ok: false, reason: '서명 헤더 누락' };
  }

  // timestamp drift 방지 — 5분 이상 차이 거부 (replay attack 보호).
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 5 * 60) {
    return { ok: false, reason: 'timestamp drift' };
  }

  let secretBytes: Buffer;
  try {
    const stripped = secretRaw.startsWith('whsec_') ? secretRaw.slice(6) : secretRaw;
    secretBytes = Buffer.from(stripped, 'base64');
  } catch {
    return { ok: false, reason: '시크릿 디코딩 실패' };
  }

  const expected = createHmac('sha256', secretBytes)
    .update(`${id}.${ts}.${rawBody}`)
    .digest('base64');
  const expectedBuf = Buffer.from(expected);

  // "v1,sig1 v1,sig2" 중 하나만 일치하면 통과.
  const parts = sigHeader.split(' ');
  for (const part of parts) {
    const [version, value] = part.split(',', 2);
    if (version !== 'v1' || !value) continue;
    const candidate = Buffer.from(value);
    if (candidate.length === expectedBuf.length && timingSafeEqual(candidate, expectedBuf)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: '서명 불일치' };
}
