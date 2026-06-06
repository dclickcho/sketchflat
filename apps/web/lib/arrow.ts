import 'server-only';

// Quiver Arrow API 헬퍼 — 도식화 PNG → 통짜 SVG 변환.
// Replicate webhook 핸들러 안에서 동기 호출 (그 함수는 maxDuration=60).
// Arrow는 async/webhook 엔드포인트가 없어 핸들러 한 사이클 안에서 끝나야 함.

const ARROW_BASE_URL = 'https://api.quiver.ai';
const ARROW_DEFAULT_MODEL = 'arrow-1.1';

export type ArrowModel = 'arrow-1.1' | 'arrow-1.1 Max' | (string & {});

type ArrowSuccess = {
  id: string;
  created: number;
  credits: number;
  data: Array<{ mime_type: string; svg: string }>;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
};

export class ArrowError extends Error {
  status: number;
  body: string;
  retryAfterSeconds: number | null;
  constructor(status: number, body: string, retryAfterSeconds: number | null) {
    super(`Arrow ${status}${retryAfterSeconds !== null ? ` (Retry-After=${retryAfterSeconds}s)` : ''}: ${body.slice(0, 500)}`);
    this.name = 'ArrowError';
    this.status = status;
    this.body = body;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type VectorizeOpts = {
  // 공개 http/https URL. Replicate가 결과로 돌려준 이미지 URL을 그대로 넘겨도 됨.
  imageUrl: string;
  // 기본 'arrow-1.1'. 'arrow-1.1 Max'는 고품질·고비용.
  model?: ArrowModel;
  // 주체 자동 크롭 (배경 여유 정리).
  autoCrop?: boolean;
  // 정사각 리사이즈 (128–4096).
  targetSize?: number;
};

// POST /v1/svgs/vectorizations — 동기 호출, 단일 SVG 문자열 반환.
// 부품 분리 기능 없음 (Track A는 raw_svg에 통째로 저장).
export async function vectorizeImage(opts: VectorizeOpts): Promise<{
  svg: string;
  credits: number;
  arrowId: string;
}> {
  const apiKey = process.env.QUIVERAI_API_KEY;
  if (!apiKey) throw new Error('QUIVERAI_API_KEY 환경변수 누락');

  const body: Record<string, unknown> = {
    model: opts.model ?? ARROW_DEFAULT_MODEL,
    image: { url: opts.imageUrl },
    stream: false,
  };
  if (opts.autoCrop !== undefined) body.auto_crop = opts.autoCrop;
  if (opts.targetSize !== undefined) body.target_size = opts.targetSize;

  const res = await fetch(`${ARROW_BASE_URL}/v1/svgs/vectorizations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
    throw new ArrowError(res.status, text, retryAfter);
  }

  const json = (await res.json()) as ArrowSuccess;
  const svg = json.data?.[0]?.svg;
  if (!svg) {
    throw new ArrowError(200, 'Arrow 응답에 svg 필드가 없음', null);
  }
  return { svg, credits: json.credits ?? 0, arrowId: json.id };
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n;
  // Retry-After가 HTTP-date 형식이면 (드물지만 스펙상 가능).
  const ts = Date.parse(value);
  if (!Number.isNaN(ts)) {
    return Math.max(0, Math.round((ts - Date.now()) / 1000));
  }
  return null;
}

// ─── 스트리밍 (보여주기 전용) ──────────────────────────────────────────────
// 실제 저장은 cron 의 vectorizeImage 가 담당. 이 경로는 사용자에게 "그려지는 모습"을
// 보여주기 위해 별도로 stream:true 호출을 한 번 더 하는 비용 트레이드오프.
//
// Quiver Arrow SSE 포맷 (2026-05-19 확인):
//   event: generating  → data: {"type":"generating","id":"..."}
//   event: draft       → data: {"type":"draft","id":"...","svg":"<svg ...>...(partial)..."}
//   event: content     → data: {"type":"content","id":"...","svg":"<full svg>","credits":...}
//   data: [DONE]
//
// svg 필드의 형태(누적 vs 증분)는 모델·버전에 따라 다를 수 있다. 2026-05-19 로그상
// arrow-1.1 은 토큰 단위 증분(델타, 1~6 글자)으로 흘렸다. 마지막 content 가 완성본.
// 소비측(canvas-panel)에서 "직전 누적본을 prefix 로 포함하면 누적, 아니면 델타"로
// 런타임 판별하므로 이 헬퍼는 svg 를 가공 없이 그대로 forward 한다.

export type ArrowStreamEvent =
  | { phase: 'generating'; svg: null }
  | { phase: 'draft'; svg: string }
  | { phase: 'content'; svg: string; credits: number }
  | { phase: 'done'; svg: null };

export async function* vectorizeImageStream(opts: VectorizeOpts): AsyncGenerator<ArrowStreamEvent> {
  const apiKey = process.env.QUIVERAI_API_KEY;
  if (!apiKey) throw new Error('QUIVERAI_API_KEY 환경변수 누락');

  const body: Record<string, unknown> = {
    model: opts.model ?? ARROW_DEFAULT_MODEL,
    image: { url: opts.imageUrl },
    stream: true,
  };
  if (opts.autoCrop !== undefined) body.auto_crop = opts.autoCrop;
  if (opts.targetSize !== undefined) body.target_size = opts.targetSize;

  const res = await fetch(`${ARROW_BASE_URL}/v1/svgs/vectorizations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
    throw new ArrowError(res.status, text, retryAfter);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 메시지 경계: 빈 줄(\n\n 또는 \r\n\r\n).
      let sep: number;
      while ((sep = findMessageBoundary(buffer)) !== -1) {
        const rawMessage = buffer.slice(0, sep);
        // 경계 길이는 2 (\n\n) 또는 4 (\r\n\r\n). findMessageBoundary 가 둘 다 반환할 수 있어
        // 다음 검사 시 정확히 잘라내도록 실제 매칭 길이를 다시 측정.
        const after = buffer.slice(sep);
        const skipLen = after.startsWith('\r\n\r\n') ? 4 : 2;
        buffer = buffer.slice(sep + skipLen);

        const parsed = parseSseMessage(rawMessage);
        if (!parsed) continue;
        if (parsed.data === '[DONE]') {
          yield { phase: 'done', svg: null };
          return;
        }
        try {
          const payload = JSON.parse(parsed.data) as {
            type?: string;
            svg?: string;
            credits?: number;
          };
          const type = payload.type ?? parsed.event;
          if (type === 'generating') {
            yield { phase: 'generating', svg: null };
          } else if (type === 'draft' && typeof payload.svg === 'string') {
            yield { phase: 'draft', svg: payload.svg };
          } else if (type === 'content' && typeof payload.svg === 'string') {
            yield {
              phase: 'content',
              svg: payload.svg,
              credits: payload.credits ?? 0,
            };
          }
          // reasoning 이벤트는 사용자에게 보여줄 SVG 없음 — 무시.
        } catch {
          // JSON 파싱 실패한 청크는 건너뛰고 스트림 계속.
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

// SSE 메시지 경계(\n\n 또는 \r\n\r\n) 의 시작 index. 없으면 -1.
function findMessageBoundary(buf: string): number {
  const a = buf.indexOf('\n\n');
  const b = buf.indexOf('\r\n\r\n');
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

// SSE 한 메시지를 event/data 필드로 파싱. data: 가 여러 줄이면 \n 으로 join.
function parseSseMessage(message: string): { event: string | null; data: string } | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of message.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue; // 빈 줄 / 주석.
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    // SSE 스펙: 콜론 뒤 공백 한 개는 제거.
    let val = line.slice(colon + 1);
    if (val.startsWith(' ')) val = val.slice(1);
    if (field === 'event') event = val;
    else if (field === 'data') dataLines.push(val);
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}
