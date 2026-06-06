'use client';

// 브라우저 DOM 조작(innerHTML, 이벤트 위임)이 필요하므로 Client Component.

import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeSvg, findHitTarget } from '@/lib/svg';

// 3초 폴링. Arrow(30~90s)는 ~10~30회, parts/LIVE(수 분)는 길게 — 둘 다 succeeded
// 즉시 종료라 상한은 안전망일 뿐. 폴링은 RLS SELECT라 cheap 하나 너무 잦으면
// Vercel 함수 호출비 낭비 → 장시간 잡 기준 3초가 균형.
const POLL_INTERVAL_MS = 3000;
// 안전망 상한: 12분. parts/LIVE 파이프라인은 Replicate 도식화 + cron 픽업 지연
// + 부위별 LIVE(~4~6분) + cron poll-finalize 지연 합산이 수 분~10분 가능 →
// 기존 2분(Arrow 기준)은 parts 잡을 항상 조기 타임아웃시켜 결과 미표시였음.
// stuck job 도 12분이면 사용자가 무한 대기에 갇히지 않는 선.
const POLL_TIMEOUT_MS = 1000 * 60 * 12;

type JobStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled';

type JobResponse = {
  job: {
    id: string;
    kind: string;
    status: JobStatus;
    project_id: string | null;
    output_sketch_url: string | null;
    output_image_url: string | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
    sketch_signed_url: string | null;
    sketch_signed_url_expires_at: string | null;
    sketch_signed_url_error: string | null;
  };
};

type Props = {
  jobId: string;
  // SVG 컨테이너 최대 폭 (px). SVG 자체는 viewBox 비율을 유지하며 100% 폭으로 채워진다.
  width?: number;
  onPartSelect?: (partId: string | null) => void;
};

export function SketchResultViewer({ jobId, width = 600, onPartSelect }: Props) {
  const [job, setJob] = useState<JobResponse['job'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderState, setRenderState] = useState<
    'idle' | 'rendering' | 'rendered' | 'render_failed'
  >('idle');
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);

  // ref + useEffect로 innerHTML 직접 조작하는 이유:
  // dangerouslySetInnerHTML은 React가 렌더마다 DOM을 교체하므로,
  // SVG 내 element에 data-part-selected 같은 imperative 속성 변경이 다음 렌더에서 날아간다.
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 현재 하이라이트된 element를 추적해 다음 클릭 시 이전 것을 지운다.
  const selectedElRef = useRef<Element | null>(null);
  // 렌더 중인 jobId 추적 — 빠른 jobId 전환 시 race 방지.
  const renderJobIdRef = useRef<string | null>(null);

  const fetchJob = useCallback(async (): Promise<JobResponse['job'] | null> => {
    const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
    if (!res.ok) {
      setError(`job 조회 실패 (${res.status})`);
      return null;
    }
    const json = (await res.json()) as JobResponse;
    setJob(json.job);
    return json.job;
  }, [jobId]);

  // 1) 상태 폴링 — 종료 상태가 되면 멈춘다.
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    setError(null);
    setRenderState('idle');
    setJob(null);

    const tick = async () => {
      if (cancelled) return;
      const j = await fetchJob();
      if (cancelled) return;
      if (!j) return;
      if (
        j.status === 'succeeded' ||
        j.status === 'failed' ||
        j.status === 'canceled'
      ) {
        return;
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setError('폴링 시간 초과 — 잠시 후 새로고침 해주세요.');
        return;
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, fetchJob]);

  // 2) succeeded + signed URL 도착 시 inline SVG 마운트.
  useEffect(() => {
    if (!job) return;
    if (job.status !== 'succeeded') return;
    if (!job.sketch_signed_url) return;
    if (renderJobIdRef.current === job.id && renderState === 'rendered') return;

    renderJobIdRef.current = job.id;
    setRenderState('rendering');
    // 새 job으로 교체될 때 이전 하이라이트 ref를 리셋한다.
    selectedElRef.current = null;
    setSelectedPartId(null);
    onPartSelect?.(null);

    let cancelled = false;
    const url = job.sketch_signed_url;

    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`SVG fetch 실패 (${res.status})`);
        const text = await res.text();

        if (cancelled) return;

        const sanitized = sanitizeSvg(text);
        if (!sanitized.ok) throw new Error(sanitized.reason);

        const container = containerRef.current;
        if (!container) return;

        container.innerHTML = sanitized.svg;

        const svgEl = container.querySelector('svg');
        if (svgEl) {
          // props.width를 존중하되 viewBox는 건드리지 않아 비율을 보존한다.
          svgEl.setAttribute('width', '100%');
          svgEl.setAttribute('height', 'auto');
          (svgEl as SVGSVGElement).style.maxWidth = `${width}px`;
        }

        if (!cancelled) setRenderState('rendered');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'SVG 렌더 실패');
          setRenderState('render_failed');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  // renderState를 deps에 포함하면 rendered 후 재진입하므로 의도적으로 제외.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, width, onPartSelect]);

  // 클릭 위임 핸들러 — SVG 내부 어디를 클릭해도 hit-test 단위를 찾아 선택.
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const hit = findHitTarget(e.target as EventTarget);

      // 이전 선택 해제.
      if (selectedElRef.current) {
        selectedElRef.current.removeAttribute('data-part-selected');
      }

      if (!hit) {
        selectedElRef.current = null;
        setSelectedPartId(null);
        onPartSelect?.(null);
        return;
      }

      hit.element.setAttribute('data-part-selected', 'true');
      selectedElRef.current = hit.element;
      setSelectedPartId(hit.partId);
      onPartSelect?.(hit.partId);
    },
    [onPartSelect],
  );

  return (
    <div className="space-y-3 rounded-md border border-input p-3">
      {/* Arrow SVG stroke를 !important로 덮는 이유: Arrow 출력은 stroke를 인라인 스타일로 직접 지정하는 경우가 있어 클래스 기반 선택자만으로는 우선순위가 밀린다. */}
      <style>{`
        [data-part-selected="true"] {
          stroke: rgb(59 130 246) !important;
          stroke-width: 3 !important;
          fill-opacity: 0.08 !important;
        }
        [data-part-hover="true"] {
          stroke: rgb(59 130 246 / 0.5) !important;
          stroke-width: 2 !important;
        }
      `}</style>

      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">sketch 미리보기</span>
        <span className="text-muted-foreground">
          {job ? `${job.status}` : '대기 중...'}
        </span>
      </div>

      {error ? (
        <p className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</p>
      ) : null}

      {job?.status === 'failed' && job.error_message ? (
        <p className="rounded bg-destructive/10 p-2 text-xs text-destructive">
          실패 원인: {job.error_message}
        </p>
      ) : null}

      {job?.sketch_signed_url_error ? (
        <p className="rounded bg-yellow-500/10 p-2 text-xs text-yellow-600">
          signed URL 생성 경고: {job.sketch_signed_url_error}
        </p>
      ) : null}

      <div
        className="flex min-h-[200px] items-center justify-center rounded bg-muted/40"
        style={{ minWidth: width }}
      >
        {job?.status === 'succeeded' ? (
          <div
            ref={containerRef}
            className="rounded border border-input bg-white"
            style={{ width: '100%', maxWidth: width, cursor: 'pointer' }}
            onClick={handleClick}
            aria-label="vectorized sketch"
          />
        ) : (
          <p className="p-6 text-xs text-muted-foreground">
            {job?.status === 'pending' || job?.status === 'processing'
              ? '도식화 생성 중...'
              : '폴링 시작 대기'}
          </p>
        )}
      </div>

      {renderState === 'rendering' ? (
        <p className="text-xs text-muted-foreground">SVG 로딩 중...</p>
      ) : null}

      {job?.sketch_signed_url ? (
        <a
          href={job.sketch_signed_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          signed URL 새 창으로 열기
        </a>
      ) : null}
    </div>
  );
}
