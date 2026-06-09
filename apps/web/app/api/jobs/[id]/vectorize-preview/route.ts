import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/auth';
import { badRequest, notFound } from '@/lib/api/errors';
import { vectorizeImageStream, ArrowError } from '@/lib/arrow';
import { createAdminClient } from '@/lib/supabase/admin';

// 통합 벡터화 SSE — Arrow stream:true 를 1번만 호출해 표시(draft) + 저장(content) 모두 처리.
// 이게 핵심: webhook 의 vectorizeImage(stream:false) 와 별개로 또 부르는 게 아니라, 이 SSE 가
// 그 잡의 "유일한" Arrow 호출이 된다(원본 SketchPack 과 동일한 단일 호출 설계). webhook 은
// atomic 락 경쟁에서 진 쪽이 되어 Arrow 를 호출하지 않는다.
//
// 흐름:
//   1) requireUser 로 본인 잡임을 검증 (RLS).
//   2) admin 으로 atomic 락: status='vectorizing' → 'streaming'. 영향 row 0 이면
//      webhook 폴백(또는 다른 탭)이 이미 선점 → 409 로 종료, 클라는 폴링으로 결과 수신.
//   3) Arrow stream:true 호출. draft 청크는 클라로 forward, content(완성본) 도착 시
//      sketches 버킷 업로드 + status='succeeded' 저장 후 'final' 로 forward.
//   4) 실패: cron 백업이 없으므로 'vectorizing' 으로 되돌리지 않고 'failed'(terminal) 처리.
//
// 클라이언트는 EventSource 로 GET. payload 는 단순 JSON:
//   data: {"phase":"draft","svg":"...(증분/누적)..."}
//   data: {"phase":"final","svg":"...(완성본)...","sketch_url":"..."}
//   data: [DONE]
//
// maxDuration=300: Arrow 평균 30~90s, 최악 ~3분 안전망.

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const UuidSchema = z.string().uuid();

type AdminClient = ReturnType<typeof createAdminClient>;

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const idCheck = UuidSchema.safeParse(params.id);
  if (!idCheck.success) return badRequest('잘못된 job ID');
  const jobId = idCheck.data;

  // 1) RLS 통해 본인 job 만 조회 가능.
  const { data: job, error } = await supabase
    .from('jobs')
    .select('id, user_id, status, output_image_url')
    .eq('id', jobId)
    .maybeSingle();

  if (error) return new Response(error.message, { status: 500 });
  if (!job) return notFound('job을 찾을 수 없습니다.');
  if (!job.output_image_url) {
    // Replicate webhook 이 아직 output_image_url 을 못 채운 상태 — 잠시 후 재시도.
    return new Response('output_image_url 아직 없음', { status: 425 });
  }
  if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled') {
    return new Response('already finished', { status: 409 });
  }
  if (job.status === 'streaming') {
    // 다른 탭/워커가 이미 SSE 처리 중. 중복 호출 방지.
    return new Response('already streaming', { status: 409 });
  }

  // 2) atomic 락 — vectorizing → streaming. RLS 가 사용자에게 status 수정을 막으니 admin 사용.
  const admin = createAdminClient();
  const { data: locked, error: lockErr } = await admin
    .from('jobs')
    .update({ status: 'streaming' })
    .eq('id', jobId)
    .eq('status', 'vectorizing')
    .select('id, user_id, output_image_url')
    .maybeSingle();

  if (lockErr) return new Response(lockErr.message, { status: 500 });
  if (!locked) {
    // 락 사이 race — webhook 폴백/다른 워커가 먼저 잡았음.
    return new Response('already claimed', { status: 409 });
  }

  const imageUrl = locked.output_image_url!;
  const userId = locked.user_id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let finalized = false;

      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // controller closed (client disconnected). 무시 — 저장 작업은 계속된다.
        }
      };
      const sendRaw = (line: string) => {
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          // controller closed. 무시.
        }
      };

      sendRaw(': open\n\n'); // SSE keep-alive 코멘트.

      try {
        for await (const evt of vectorizeImageStream({ imageUrl })) {
          if (evt.phase === 'generating') {
            send({ phase: 'generating' });
          } else if (evt.phase === 'draft') {
            send({ phase: 'draft', svg: evt.svg });
          } else if (evt.phase === 'content') {
            // 정본 도착 — 저장 후 finalized 마킹. 클라이언트가 SSE 를 미리 끊어도
            // 이 비동기 작업은 백그라운드에서 끝까지 실행돼 정본 저장을 보장한다.
            const sketchUrl = await finalizeJob(admin, jobId, userId, evt.svg);
            finalized = true;
            send({ phase: 'final', svg: evt.svg, sketch_url: sketchUrl });
          } else if (evt.phase === 'done') {
            sendRaw('data: [DONE]\n\n');
            break;
          }
        }
        if (!finalized) {
          // content 없이 스트림 종료 — 비정상. cron 백업이 없으므로 terminal 처리.
          await admin
            .from('jobs')
            .update({ status: 'failed', error_message: 'Arrow content(정본) 미수신' })
            .eq('id', jobId)
            .eq('status', 'streaming');
        }
      } catch (err) {
        const message =
          err instanceof ArrowError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'arrow stream 실패';
        send({ phase: 'error', message });
        if (!finalized) {
          // 되돌리면 cron 이 없어 orphan('vectorizing' 영구 정체) → 'failed' 로 마감.
          await admin
            .from('jobs')
            .update({ status: 'failed', error_message: `[arrow] ${message}`.slice(0, 500) })
            .eq('id', jobId)
            .eq('status', 'streaming');
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// content 청크의 완성 SVG 를 sketches 버킷에 저장하고 잡을 succeeded 로 마감.
// webhook 폴백 경로와 동일한 저장 규약: '<user_id>/<job_id>.svg'.
// 반환: output_sketch_url (Storage path).
async function finalizeJob(
  admin: AdminClient,
  jobId: string,
  userId: string,
  svg: string,
): Promise<string> {
  const sketchPath = `${userId}/${jobId}.svg`;
  const upload = await admin.storage
    .from('sketches')
    .upload(sketchPath, svg, { contentType: 'image/svg+xml', upsert: true });
  if (upload.error) {
    throw new Error(`sketch 업로드 실패: ${upload.error.message}`);
  }

  const { error: updateErr } = await admin
    .from('jobs')
    .update({ status: 'succeeded', output_sketch_url: sketchPath, error_message: null })
    .eq('id', jobId);
  if (updateErr) {
    throw new Error(`jobs 업데이트 실패: ${updateErr.message}`);
  }

  return sketchPath;
}
