import 'server-only';

// Replicate async prediction 헬퍼.
// 4단계 webhook 핸들러가 결과를 받아 Arrow → Sketch 스키마 변환 후 DB 갱신한다.
// 동기 호출(Prefer: wait)은 사용하지 않는다 — 도식화 생성은 수십 초 걸릴 수 있어 webhook 전제.

const REPLICATE_BASE_URL = 'https://api.replicate.com';

// MVP 임시 모델. 자체 LoRA 파인튜닝 모델이 Replicate에 배포되면 이 상수만 교체.
// kind별로 다른 모델을 쓰게 되면 라우팅 테이블로 분리한다 (현재는 image_to_sketch 단일 경로).
export const IMAGE_TO_SKETCH_MODEL = 'black-forest-labs/flux-2-pro';

export type ReplicateStatus =
  | 'starting'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export type ReplicatePrediction = {
  id: string;
  status: ReplicateStatus;
  model: string;
  version?: string;
  input: Record<string, unknown>;
  output: unknown;
  error: string | null;
  logs: string | null;
  created_at: string;
};

export class ReplicateError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Replicate ${status}: ${body.slice(0, 500)}`);
    this.name = 'ReplicateError';
    this.status = status;
    this.body = body;
  }
}

type CreateOpts = {
  // "owner/name" 형태의 호스팅 모델 슬러그.
  model: string;
  input: Record<string, unknown>;
  // 결과 도착 시 호출될 절대 URL. Replicate-Signature 헤더로 검증 (webhook 핸들러 책임).
  webhook?: string;
  // 'completed'만 받아도 충분 (시작/로그 이벤트는 Track A에서 사용 안 함).
  webhookEvents?: Array<'start' | 'output' | 'logs' | 'completed'>;
};

// POST /v1/models/{owner}/{name}/predictions — 호스팅 모델용 엔드포인트.
// 버전 해시(:version) 없이 모델 슬러그만으로 호출 가능 (최신 버전 자동 사용).
// 파인튜닝 모델로 교체할 때 버전 고정이 필요하면 슬러그에 ":<hash>"를 붙이고 /v1/predictions로 옮긴다.
export async function createPrediction(
  opts: CreateOpts,
): Promise<ReplicatePrediction> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN 환경변수 누락');

  const slash = opts.model.indexOf('/');
  if (slash <= 0 || slash === opts.model.length - 1) {
    throw new Error(`잘못된 모델 슬러그: ${opts.model}`);
  }
  const owner = opts.model.slice(0, slash);
  const name = opts.model.slice(slash + 1);

  const body: Record<string, unknown> = { input: opts.input };
  if (opts.webhook) {
    body.webhook = opts.webhook;
    body.webhook_events_filter = opts.webhookEvents ?? ['completed'];
  }

  const res = await fetch(
    `${REPLICATE_BASE_URL}/v1/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/predictions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ReplicateError(res.status, text);
  }
  return (await res.json()) as ReplicatePrediction;
}

// Replicate가 결과를 보낼 콜백 URL.
// job_id를 쿼리에 실어 핸들러가 어느 jobs 행인지 즉시 식별 — replicate_id 인덱스 조회를 한 번 아낀다.
// 서명 검증은 핸들러에서 Replicate-Signature 헤더로 별도 수행.
export function buildWebhookUrl(jobId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (!base) {
    throw new Error('NEXT_PUBLIC_APP_URL 또는 APP_URL 환경변수 필요');
  }
  return `${base.replace(/\/$/, '')}/api/webhooks/replicate?job=${encodeURIComponent(jobId)}`;
}

// flux-2-pro용 input 페이로드 (MVP 검증용).
// 파인튜닝 모델 교체 시 input 스키마가 달라지면 이 함수도 같이 갈아끼운다.
// 참조 이미지는 input_images 배열로 전달 (최대 8장). aspect_ratio=match_input_image면 첫 입력 이미지 비율을 따름.
export function buildImageToSketchInput(opts: {
  sourceImageUrl: string;
  prompt?: string;
  aspectRatio?: string;
}): Record<string, unknown> {
  return {
    prompt:
      opts.prompt ??
      'fashion technical flat sketch, clean black line drawing on pure white background, no shading, no color, front view, high contrast outlines',
    input_images: [opts.sourceImageUrl],
    aspect_ratio: opts.aspectRatio ?? 'match_input_image',
    output_format: 'png',
    safety_tolerance: 2,
  };
}
