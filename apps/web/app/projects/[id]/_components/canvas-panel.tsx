'use client';
// Konva Stage / react-konva는 브라우저 전용 — SSR 불가. 'use client' 필수.

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Stage,
  Layer,
  Path,
  Image as KonvaImage,
  Transformer,
  Rect,
  Circle,
  Line,
  Group,
  Text,
} from 'react-konva';
import type Konva from 'konva';
import {
  SketchSchema,
  type Sketch,
  type Part,
  type PartFill,
  type Transform,
  DEFAULT_TRANSFORM,
  fillToCssColor,
} from '@sketchflat/svg-schema';
import { createClient } from '@/lib/supabase/client';
import { loadSketchDraft, saveGenJob, clearGenJob } from '@/lib/web-storage';
import { useEditorStore, useTemporalStore, type AnchorRef, type Viewport } from '@/lib/editor-store';
import { svgToDataUrl, getCanvasSize } from '@/lib/konva-renderer';
import { projectOntoSegment, type Pt } from '@/lib/bezier-utils';
import { ContextMenu, type ContextMenuSection } from './context-menu';
import { UploadPhase } from './upload-phase';
import { ImageInputPanel } from './image-input-panel';
import { BrushLayer } from './brush-layer';

// PartFill (단색 string | linear | radial | pattern) → Konva.Path props.
// 그라디언트는 react-konva 의 fillLinearGradient*/fillRadialGradient* prop 으로 매핑한다.
// patternFill 은 별도 이미지 캐시가 필요해 v1 에선 평균색으로 폴백 — fillToCssColor 로 처리.
type KonvaFillProps = {
  fill?: string;
  fillEnabled: boolean;
  fillLinearGradientStartPoint?: { x: number; y: number };
  fillLinearGradientEndPoint?: { x: number; y: number };
  fillLinearGradientColorStops?: Array<number | string>;
  fillRadialGradientStartPoint?: { x: number; y: number };
  fillRadialGradientStartRadius?: number;
  fillRadialGradientEndPoint?: { x: number; y: number };
  fillRadialGradientEndRadius?: number;
  fillRadialGradientColorStops?: Array<number | string>;
  fillPriority?: 'color' | 'linear-gradient' | 'radial-gradient' | 'pattern';
};
function fillToKonvaProps(fill: PartFill | undefined): KonvaFillProps {
  if (fill === undefined || fill === null || fill === 'none') {
    return { fillEnabled: false };
  }
  if (typeof fill === 'string') {
    return { fill, fillEnabled: true };
  }
  if (fill.kind === 'linear') {
    // Konva 는 [offset, color, offset, color, ...] 평탄 배열.
    const stops: Array<number | string> = [];
    for (const s of fill.stops) {
      stops.push(s.offset, s.color);
    }
    return {
      fillEnabled: true,
      fillPriority: 'linear-gradient',
      fillLinearGradientStartPoint: { x: fill.x1, y: fill.y1 },
      fillLinearGradientEndPoint: { x: fill.x2, y: fill.y2 },
      fillLinearGradientColorStops: stops,
    };
  }
  if (fill.kind === 'radial') {
    const stops: Array<number | string> = [];
    for (const s of fill.stops) {
      stops.push(s.offset, s.color);
    }
    return {
      fillEnabled: true,
      fillPriority: 'radial-gradient',
      fillRadialGradientStartPoint: { x: fill.fx, y: fill.fy },
      fillRadialGradientStartRadius: fill.r0,
      fillRadialGradientEndPoint: { x: fill.cx, y: fill.cy },
      fillRadialGradientEndRadius: fill.r1,
      fillRadialGradientColorStops: stops,
    };
  }
  // pattern 등 미지원 — 평균색 폴백.
  const css = fillToCssColor(fill);
  if (css === 'none') return { fillEnabled: false };
  return { fill: css, fillEnabled: true };
}

// ────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;
const ZOOM_SENSITIVITY = 1.05;
// 줌 도구(돋보기) 클릭 한 번당 배율. 한 번 클릭으로 충분히 확대되도록 2×.
// Alt+클릭은 1/2×로 축소.
const ZOOM_TOOL_FACTOR = 2;

const SELECTION_FILL = 'rgba(56, 132, 255, 0.08)';
const SELECTION_STROKE = 'rgba(56, 132, 255, 0.9)';
// 파트의 stroke_width 와 무관하게 선택/호버 표시는 항상 같은 화면 픽셀 두께로 보이도록 고정.
// viewport.zoom 으로 나눠 world 좌표로 변환해 사용한다.
const SELECTION_STROKE_WIDTH_PX = 1.5;

// Anchor/handle 오버레이 시각 상수 — 모두 화면 픽셀 기준이라 viewport.zoom으로 나눠 사용한다.
// Illustrator 컨벤션을 따라 anchor는 사각형, handle은 원, 사이는 가는 직선.
// 선택/비선택 상태가 한눈에 구분되도록 anchor 사각형을 충분히 크게(7px) 잡고
// handle은 그보다 살짝 작게(4px) 유지해 위계를 만든다.
const ANCHOR_SIDE_PX = 7;
const HANDLE_RADIUS_PX = 4;
const OVERLAY_STROKE_WIDTH_PX = 1;

// 새 sketch가 로드될 때 캔버스를 viewport 가운데에 맞춰주는 fit-to-view 여백.
const FIT_PADDING = 40;

// ── 눈금자(Ruler) ───────────────────────────────────────────
// 상단 가로 + 좌측 세로 눈금자. world 좌표(=캔버스 px)를 표시한다. 라이트 테마에 맞춰
// 밝은 회색 바 + 어두운 회색 눈금/숫자. zoom 에 따라 1·2·5×10ⁿ 간격으로 라벨을 둔다.
const RULER_THICKNESS = 18;

function rulerNiceStep(zoom: number): number {
  // 라벨이 화면상 ~80px 간격으로 오도록 world step 을 1·2·5 배수로 반올림.
  const rawWorld = 80 / zoom;
  const pow = Math.pow(10, Math.floor(Math.log10(rawWorld)));
  const norm = rawWorld / pow;
  const mul = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return mul * pow;
}

function CanvasRuler({
  width,
  height,
  viewport,
}: {
  width: number;
  height: number;
  viewport: Viewport;
}) {
  if (width <= 0 || height <= 0 || viewport.zoom <= 0) return null;
  const step = rulerNiceStep(viewport.zoom);
  const bg = 'rgba(248,248,248,0.95)';
  const line = '#c8c8c8';
  const text = '#7a7a7a';

  // 가로 눈금 — 화면에 보이는 world X 범위를 step 간격으로.
  const worldLeft = (0 - viewport.x) / viewport.zoom;
  const worldRight = (width - viewport.x) / viewport.zoom;
  const xTicks: number[] = [];
  for (let w = Math.ceil(worldLeft / step) * step; w <= worldRight; w += step) xTicks.push(w);

  const worldTop = (0 - viewport.y) / viewport.zoom;
  const worldBottom = (height - viewport.y) / viewport.zoom;
  const yTicks: number[] = [];
  for (let w = Math.ceil(worldTop / step) * step; w <= worldBottom; w += step) yTicks.push(w);

  return (
    <>
      {/* 상단 가로 눈금자 */}
      <svg
        width={width}
        height={RULER_THICKNESS}
        className="absolute left-0 top-0"
        style={{ pointerEvents: 'none' }}
      >
        <rect x={0} y={0} width={width} height={RULER_THICKNESS} fill={bg} />
        <line x1={0} y1={RULER_THICKNESS - 0.5} x2={width} y2={RULER_THICKNESS - 0.5} stroke={line} strokeWidth={1} />
        {xTicks.map((w) => {
          const sx = w * viewport.zoom + viewport.x;
          return (
            <g key={w}>
              <line x1={sx} y1={RULER_THICKNESS - 5} x2={sx} y2={RULER_THICKNESS} stroke={line} strokeWidth={1} />
              <text x={sx + 3} y={9} fontSize={9} fill={text} style={{ userSelect: 'none' }}>
                {Math.round(w)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* 좌측 세로 눈금자 */}
      <svg
        width={RULER_THICKNESS}
        height={height}
        className="absolute left-0 top-0"
        style={{ pointerEvents: 'none' }}
      >
        <rect x={0} y={0} width={RULER_THICKNESS} height={height} fill={bg} />
        <line x1={RULER_THICKNESS - 0.5} y1={0} x2={RULER_THICKNESS - 0.5} y2={height} stroke={line} strokeWidth={1} />
        {yTicks.map((w) => {
          const sy = w * viewport.zoom + viewport.y;
          return (
            <g key={w}>
              <line x1={RULER_THICKNESS - 5} y1={sy} x2={RULER_THICKNESS} y2={sy} stroke={line} strokeWidth={1} />
              <text
                x={9}
                y={sy - 3}
                fontSize={9}
                fill={text}
                transform={`rotate(-90 9 ${sy - 3})`}
                style={{ userSelect: 'none' }}
              >
                {Math.round(w)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* 좌상단 코너 — 두 눈금자가 만나는 빈 사각형 */}
      <div
        className="absolute left-0 top-0"
        style={{ width: RULER_THICKNESS, height: RULER_THICKNESS, background: bg, borderRight: `1px solid ${line}`, borderBottom: `1px solid ${line}` }}
      />
    </>
  );
}

// part-local ↔ world(=캔버스) 좌표 변환. Konva Group 과 동일하게 T·R·S 순서로 적용한다.
// 펜툴은 world 좌표로 동작하지만 part.anchors 는 part-local 이라, 사용자가 옮긴/회전한
// 파트에 이어그리기를 재개할 때 이 변환으로 좌표계를 맞춘다. identity transform 이면 no-op.
function partLocalToWorld(t: Transform, p: Pt): Pt {
  const sx = t.scaleX || 1;
  const sy = t.scaleY || 1;
  const rad = ((t.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const x = p.x * sx;
  const y = p.y * sy;
  return { x: x * cos - y * sin + t.x, y: x * sin + y * cos + t.y };
}

function partWorldToLocal(t: Transform, p: Pt): Pt {
  const sx = t.scaleX || 1;
  const sy = t.scaleY || 1;
  const rad = ((t.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ux = p.x - t.x;
  const uy = p.y - t.y;
  // R(-θ) 후 스케일 역적용.
  const rx = ux * cos + uy * sin;
  const ry = -ux * sin + uy * cos;
  return { x: rx / sx, y: ry / sy };
}

// Arrow draft 청크를 브라우저가 렌더 가능한 SVG 로 정제.
// Arrow 가 보내는 svg 필드는 토큰 단위 증분(델타) — 1~6 글자씩 흘러옴.
// 누적본은 <svg ...><style>...</style><path .../><path d="M 88...   같이 마지막이 미완성.
// HTML 파서는 미완성 element 를 무시하고 그 앞 element 는 정상 그리므로,
// 마지막 미완성 토큰/속성만 살짝 잘라내고 </svg> 만 보장하면 path 들이 닫히는 대로 차례로 보임.
function closePartialSvg(s: string): string {
  if (!s) return s;
  let safe = s;
  // 1) 미완성 속성 값 (홀수 개의 따옴표) — 마지막 따옴표 이후 잘라낸다.
  //    예: ...d="M 88   → 마지막 " 이후 'M 88' 제거.
  //    Arrow 도식화 SVG 의 <style> 블록엔 CSS 만 있어 " 가 안 나오므로 안전.
  const quoteCount = (safe.match(/"/g) ?? []).length;
  if (quoteCount % 2 === 1) {
    safe = safe.slice(0, safe.lastIndexOf('"'));
  }
  // 2) 미완성 element (< 가 짝 > 없이 떠 있음) — 마지막 < 이후 잘라낸다.
  const lastLt = safe.lastIndexOf('<');
  const lastGt = safe.lastIndexOf('>');
  if (lastLt > lastGt) safe = safe.slice(0, lastLt);
  // 3) </svg> 보장.
  if (!/<\/svg>\s*$/.test(safe)) safe += '</svg>';
  // 4) Arrow SVG 는 viewBox 만 있고 width/height 가 없어 wrapper 에서 0×0 으로 사라질 수 있다.
  //    width/height 가 없으면 100% 로 강제 주입해 부모 박스를 채우게 한다.
  safe = safe.replace(/<svg(\s[^>]*)?>/, (match, attrs: string | undefined) => {
    const a = attrs ?? '';
    if (/\b(width|height)\s*=/.test(a)) return match;
    return `<svg${a} width="100%" height="100%">`;
  });
  return safe;
}

// Arrow 누적본은 큰 <style> 블록이 먼저 토큰 단위로 흘러온 뒤에야 첫 <path> 가 닫힌다.
// 그 사이에는 그릴 게 없어 빈 흰 화면이 되므로, 실제 그려질 element 가 하나라도
// 생기기 전까지는 스피너를 유지하기 위한 판별.
function svgHasRenderable(svg: string): boolean {
  return /<(path|polygon|polyline|rect|circle|ellipse|line|image|text|use|g)[\s/>]/i.test(
    svg,
  );
}

// "현재 그려지는 선만 파랗게" 애니메이션을 주려면 element 단위로 React 키잉이 필요하다.
// dangerouslySetInnerHTML 한 덩어리는 매 청크마다 DOM 을 통째 재생성해서 — 이미 그려진
// path 도 다시 mount 되고, 따라서 CSS 애니메이션이 모두 재시작된다 ("툭툭 다 같이 다시 그림").
// 그래서 SVG 를 한 번 파싱해서 직속 자식들을 배열로 뽑아두고, 각자를 <g key={i}> 로 감싸
// React 의 key 매칭을 태운다 — i 가 안정적이면 기존 element 는 reuse, 새 i 만 mount.
type ParsedPreviewSvg = {
  viewBox: string | null;
  /** Arrow 가 svg 본문 앞에 흘려보내는 <defs>/<style> 등 비-렌더 노드. 통째로 한 번에 주입. */
  preludeHtml: string;
  /** path/polygon 같은 개별 렌더 element. 각자 outerHTML 문자열. */
  elements: string[];
  /** Arrow 가 final 청크를 보낸 후에는 "현재 그려지는 선" 표시가 사라져야 한다. */
  isFinal: boolean;
};

// 한 element 한 element 별로 mount 시점을 잡아야 애니메이션이 자연스럽다 (한꺼번에 mount 되어
// 동시 애니메이션 되면 "그려지는 중"이라기보다 "팝업" 느낌). React 의 key 정책에 맡긴다.
// path 단위로 키잉해야 "지금 그려지는 한 선만 파랑" 이 되므로, leaf(=path 등) 만 element 로 잡는다.
const RENDERABLE_LEAF =
  /^(path|polygon|polyline|rect|circle|ellipse|line|image|text|use)$/;

// image/svg+xml 우선 + HTML 파서 폴백:
// - image/svg+xml 은 case-sensitive 라 viewBox/preserveAspectRatio 같은 camelCase attr 이
//   그대로 보존된다. 가능하면 이걸로.
// - 단, 엄격한 XML 파서라 path d 에 깨진 entity 가 하나라도 있으면 통째로 parsererror →
//   미리보기가 영원히 안 뜬다 (방금 푸시한 코드의 버그). HTML 파서는 부분/잘못된 입력도
//   best-effort 로 트리를 구성하고, foreign content 규칙으로 SVG camelCase attr 들도
//   대부분 복원해 준다.
function parsePreviewSvg(svg: string, isFinal: boolean): ParsedPreviewSvg | null {
  if (typeof window === 'undefined') return null;
  let root: Element | null = null;
  // 1) 엄격 XML — 잘 닫힌 SVG 면 이게 가장 정확.
  try {
    const xmlDoc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const hasError = xmlDoc.getElementsByTagName('parsererror').length > 0;
    const docEl = xmlDoc.documentElement;
    if (!hasError && docEl && docEl.tagName.toLowerCase() === 'svg') {
      root = docEl;
    }
  } catch {
    // fall through
  }
  // 2) HTML 파서 폴백 — 관대한 파서.
  if (!root) {
    try {
      const htmlDoc = new DOMParser().parseFromString(
        `<!DOCTYPE html><body>${svg}</body>`,
        'text/html',
      );
      root = htmlDoc.body?.querySelector('svg') ?? null;
    } catch {
      return null;
    }
  }
  if (!root) return null;

  const viewBox = root.getAttribute('viewBox');

  // 대지 전체를 덮는 배경 사각형 판별. Arrow 는 본문 path 들보다 먼저 viewBox 와 같은 크기의
  // <rect>(흰 배경) 를 흘려보내는데, 이는 실제 결과(parts)엔 없는 패스다. 그대로 두면 미리보기
  // CSS 가 rect 에도 stroke 를 강제로 입혀(현재선이면 파랑) "대지 크기의 파란 네모"가 가장 먼저
  // 그려진다. viewBox 폭/높이를 거의 다 덮는 rect 만 골라 미리보기에서 제외한다.
  const vbParts = (viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  const vbW = vbParts.length >= 4 && Number.isFinite(vbParts[2]) ? vbParts[2] : null;
  const vbH = vbParts.length >= 4 && Number.isFinite(vbParts[3]) ? vbParts[3] : null;
  const isFullCanvasRect = (el: Element): boolean => {
    if (el.tagName.toLowerCase() !== 'rect' || vbW === null || vbH === null) return false;
    const dim = (attr: string, full: number): number | null => {
      const raw = el.getAttribute(attr)?.trim();
      if (!raw) return null;
      if (raw.endsWith('%')) {
        const pct = parseFloat(raw);
        return Number.isFinite(pct) ? (pct / 100) * full : null;
      }
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : null;
    };
    const w = dim('width', vbW);
    const h = dim('height', vbH);
    if (w === null || h === null) return false;
    // 폭·높이가 모두 viewBox 의 95% 이상이면 배경으로 간주.
    return w >= vbW * 0.95 && h >= vbH * 0.95;
  };

  // Arrow 는 path 들을 <g data-category="body"> … </g> 처럼 카테고리 wrapper <g> 여러 개로
  // 묶어 흘려보낸다. 이 g 를 그대로 element 로 잡으면 "지금 그려지는 선" 표시(data-current)가
  // 그룹 통째에 걸려 그룹 안 path 가 전부 파래진다. 그래서 g 는 펼쳐서 안쪽 leaf(path 등) 를
  // 개별 element 로 모은다 — 그래야 마지막 한 path 만 파랗게, 나머지는 원본(검정)으로 남는다.
  // 단 g 에 transform 이 있으면 펼치면 좌표가 깨지므로 그 g 만 통째로 둔다 (Arrow 카테고리
  // g 는 transform 이 없어 보통 펼쳐진다).
  const collectFrom = (parent: Element, into: { prelude: string; elements: string[] }) => {
    for (const child of Array.from(parent.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'defs' || tag === 'style' || tag === 'title' || tag === 'desc') {
        into.prelude += child.outerHTML;
      } else if (tag === 'g') {
        if (child.hasAttribute('transform')) {
          into.elements.push(child.outerHTML);
        } else {
          collectFrom(child, into);
        }
      } else if (RENDERABLE_LEAF.test(tag)) {
        // 대지 크기 배경 rect 는 실제 패스가 아니므로 미리보기에서 제외.
        if (isFullCanvasRect(child)) continue;
        into.elements.push(child.outerHTML);
      }
    }
  };

  const bucket = { prelude: '', elements: [] as string[] };
  collectFrom(root, bucket);

  if (bucket.elements.length === 0 && bucket.prelude.length === 0) return null;

  return {
    viewBox,
    preludeHtml: bucket.prelude,
    elements: bucket.elements,
    isFinal,
  };
}

// (A) reveal 모션은 각 path 의 실제 길이(getTotalLength)를 측정해 inline 으로 dasharray/dashoffset 을
// 직접 컨트롤한다. 옛 구현은 CSS 에 dasharray=5000 고정 — typical Arrow path 길이가 200~800 라 reveal
// 구간이 5%(~25ms)밖에 안 돼 사실상 모션이 안 보였다. 여기서는 길이=L 로 잡아 정확히 0.55s 동안
// 0→L 만큼 dashoffset 이 줄어들면서 "선이 자라는" 효과를 보장.
// (b) cross-fade 는 CSS 의 `.vectorize-preview path { transition: stroke 350ms }` 가 담당 —
// data-current 가 빠질 때 파랑→회색이 instant 가 아니라 부드러운 페이드.
// isCurrent prop 변화만으로는 reveal 을 재실행하지 않는다 (deps=[html]). html 자체가 바뀔 때만 — 즉
// element 가 새로 mount 되거나 parser 결과가 실제로 달라진 경우만 한 번.
function PreviewElement({
  html,
  isCurrent,
}: {
  html: string;
  isCurrent: boolean;
}) {
  const gRef = useRef<SVGGElement>(null);
  // useLayoutEffect — paint 직전에 dasharray/dashoffset 을 invisible 상태로 잡아두지 않으면,
  // useEffect 는 paint 후 실행이라 한 프레임 동안 "완성된 path 가 그대로 보이는" 깜빡임이 발생한다.
  useLayoutEffect(() => {
    const g = gRef.current;
    if (!g) return;
    const leaves = g.querySelectorAll<SVGGeometryElement>(
      'path, polygon, polyline, line, rect, circle, ellipse',
    );
    const targets: SVGGeometryElement[] = [];
    leaves.forEach((el) => {
      if (typeof el.getTotalLength !== 'function') return;
      let len = 0;
      try {
        len = el.getTotalLength();
      } catch {
        return;
      }
      if (!Number.isFinite(len) || len <= 0) return;
      // 시작 상태: dasharray=L, dashoffset=L → 완전 invisible. transition=none 으로 박제.
      el.style.transition = 'none';
      el.style.strokeDasharray = String(len);
      el.style.strokeDashoffset = String(len);
      targets.push(el);
    });
    if (targets.length === 0) return;
    // 시작 상태 commit 강제 — getBoundingClientRect 로 layout flush 안 하면 다음 rAF 의
    // dashoffset 변경이 batched 되어 transition 이 0→0 으로 단축돼 모션이 사라진다.
    void g.getBoundingClientRect();
    const raf = requestAnimationFrame(() => {
      targets.forEach((el) => {
        el.style.transition = 'stroke-dashoffset 550ms ease-out';
        el.style.strokeDashoffset = '0';
      });
    });
    // 애니메이션 종료 후 inline style 청소 — 이후 stroke 색 cross-fade 와 섞이지 않도록.
    // 550ms 모션 + rAF 1프레임 여유로 700ms.
    const cleanupTimer = setTimeout(() => {
      targets.forEach((el) => {
        el.style.transition = '';
        el.style.strokeDasharray = '';
        el.style.strokeDashoffset = '';
      });
    }, 700);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(cleanupTimer);
    };
  }, [html]);
  return (
    <g
      ref={gRef}
      data-current={isCurrent ? 'true' : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// 이미지 업로드 / 잡 재개 직후 잠시 띄울 "빈 sketch + 대지1 1장" placeholder.
// 사용자가 결과를 기다리는 동안 캔버스가 그대로 보이고, 그 위에 진행 미리보기
// (스피너 → Arrow 스트림 SVG)가 대지 안쪽에 겹쳐 보이게 한다.
// SketchSchema refine 은 parts.length>0 || raw_svg 를 요구하지만 setSketch 는 검증을
// 거치지 않아 그대로 통과한다. 실제 SVG 가 도착하면 곧 진짜 sketch 로 교체된다.
function createPlaceholderSketch(): Sketch {
  const now = new Date().toISOString();
  return {
    schema_version: '1.0.0',
    sketch_id: crypto.randomUUID(),
    garment_type: 'other',
    view: 'front',
    canvas: { width: 800, height: 1000 },
    parts: [],
    annotations: [],
    artboards: [
      {
        id: `artboard_placeholder_${Date.now().toString(36)}`,
        name: '대지1',
        x: 0,
        y: 0,
        width: 800,
        height: 1000,
      },
    ],
    group_names: {},
    group_parents: {},
    brush_definitions: [],
    created_at: now,
    updated_at: now,
  } as Sketch;
}

// ────────────────────────────────────────────────────────────
// 타입
// ────────────────────────────────────────────────────────────
type Props = { projectId: string };

type FetchPhase =
  | { tag: 'loading' }
  | { tag: 'upload' }
  | { tag: 'canvas' }
  | { tag: 'error'; message: string };

interface ProjectResponse {
  project: { id: string; title: string; sketch: unknown };
}

interface JobResponse {
  job: {
    id: string;
    status: string;
    sketch_signed_url: string | null;
    sketch_signed_url_error: string | null;
    error_message: string | null;
    // Replicate 가 만든 PNG (스케치화된 결과). Arrow 가 다시 SVG 로 벡터화하기 전 단계 — 사용자가
    // 원본 결과물을 확인할 수 있도록 새 탭에서 여는 버튼에 사용.
    output_image_url: string | null;
  };
}

interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ────────────────────────────────────────────────────────────
// 컴포넌트
// ────────────────────────────────────────────────────────────
export default function CanvasPanel({ projectId }: Props) {
  // ── 에디터 전역 상태 ──────────────────────────────────────
  const sketch = useEditorStore((s) => s.sketch);
  const setSketch = useEditorStore((s) => s.setSketch);
  const markSketchSynced = useEditorStore((s) => s.markSketchSynced);
  const ingestRawSvgAsParts = useEditorStore((s) => s.ingestRawSvgAsParts);
  const refreshPartStylesFromRawSvg = useEditorStore(
    (s) => s.refreshPartStylesFromRawSvg,
  );
  const backfillAnchorsFromRawSvg = useEditorStore(
    (s) => s.backfillAnchorsFromRawSvg,
  );
  const viewport = useEditorStore((s) => s.viewport);
  const setViewport = useEditorStore((s) => s.setViewport);
  const selectedPartIds = useEditorStore((s) => s.selectedPartIds);
  const selectPart = useEditorStore((s) => s.selectPart);
  const selectMany = useEditorStore((s) => s.selectMany);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const updatePartTransform = useEditorStore((s) => s.updatePartTransform);
  const updatePartStyle = useEditorStore((s) => s.updatePartStyle);
  const copyStyleFromPart = useEditorStore((s) => s.copyStyleFromPart);
  const updatePartTransforms = useEditorStore((s) => s.updatePartTransforms);
  const updateAnchorPosition = useEditorStore((s) => s.updateAnchorPosition);
  const updateHandle = useEditorStore((s) => s.updateHandle);
  const setAnchorKind = useEditorStore((s) => s.setAnchorKind);
  const insertAnchor = useEditorStore((s) => s.insertAnchor);
  const deleteAnchor = useEditorStore((s) => s.deleteAnchor);
  const createPenPart = useEditorStore((s) => s.createPenPart);
  const appendAnchorToPart = useEditorStore((s) => s.appendAnchorToPart);
  const resumePenAtAnchor = useEditorStore((s) => s.resumePenAtAnchor);
  const setLastAnchorHandleOut = useEditorStore((s) => s.setLastAnchorHandleOut);
  const closeLastSubpath = useEditorStore((s) => s.closeLastSubpath);
  const createRectPart = useEditorStore((s) => s.createRectPart);
  const createEllipsePart = useEditorStore((s) => s.createEllipsePart);
  const groupParts = useEditorStore((s) => s.groupParts);
  const ungroupParts = useEditorStore((s) => s.ungroupParts);
  const getGroupMemberIds = useEditorStore((s) => s.getGroupMemberIds);
  const copyParts = useEditorStore((s) => s.copyParts);
  const pasteParts = useEditorStore((s) => s.pasteParts);
  const nudgeParts = useEditorStore((s) => s.nudgeParts);
  const selectedAnchorId = useEditorStore((s) => s.selectedAnchorId);
  const selectedAnchors = useEditorStore((s) => s.selectedAnchors);
  const selectAnchor = useEditorStore((s) => s.selectAnchor);
  const selectAnchors = useEditorStore((s) => s.selectAnchors);
  const addAnchorsToSelection = useEditorStore((s) => s.addAnchorsToSelection);
  const toggleAnchorInSelection = useEditorStore((s) => s.toggleAnchorInSelection);
  const clearAnchorSelection = useEditorStore((s) => s.clearAnchorSelection);
  const translateAnchors = useEditorStore((s) => s.translateAnchors);
  const deleteAnchors = useEditorStore((s) => s.deleteAnchors);
  const joinAnchors = useEditorStore((s) => s.joinAnchors);
  const trySnapCloseAtAnchors = useEditorStore((s) => s.trySnapCloseAtAnchors);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const duplicateParts = useEditorStore((s) => s.duplicateParts);
  const deleteParts = useEditorStore((s) => s.deleteParts);
  const setJobStatus = useEditorStore((s) => s.setJobStatus);
  // 진행 중 잡 여부 — placeholder 대지 위에 미리보기/스피너 오버레이를 띄우는 조건.
  const jobStatus = useEditorStore((s) => s.jobStatus);
  const activeTool = useEditorStore((s) => s.activeTool);
  const flipPartsHorizontal = useEditorStore((s) => s.flipPartsHorizontal);
  const flipPartsVertical = useEditorStore((s) => s.flipPartsVertical);
  const unitePaths = useEditorStore((s) => s.unitePaths);
  const dividePaths = useEditorStore((s) => s.dividePaths);
  const subtractPaths = useEditorStore((s) => s.subtractPaths);
  const intersectPaths = useEditorStore((s) => s.intersectPaths);
  const excludePaths = useEditorStore((s) => s.excludePaths);
  const bringToFront = useEditorStore((s) => s.bringToFront);
  const sendToBack = useEditorStore((s) => s.sendToBack);
  const toggleVisibility = useEditorStore((s) => s.toggleVisibility);
  const toggleLock = useEditorStore((s) => s.toggleLock);
  const artboards = useEditorStore((s) => s.sketch?.artboards);
  const selectedArtboardId = useEditorStore((s) => s.selectedArtboardId);
  const createArtboard = useEditorStore((s) => s.createArtboard);
  const seedDefaultArtboardFromCanvas = useEditorStore(
    (s) => s.seedDefaultArtboardFromCanvas,
  );
  const selectArtboard = useEditorStore((s) => s.selectArtboard);
  const updateArtboard = useEditorStore((s) => s.updateArtboard);
  const deleteArtboard = useEditorStore((s) => s.deleteArtboard);

  // ── 로컬 상태 ────────────────────────────────────────────
  const [phase, setPhase] = useState<FetchPhase>({ tag: 'loading' });
  const [jobId, setJobId] = useState<string | null>(null);
  const [konvaImage, setKonvaImage] = useState<HTMLImageElement | null>(null);

  // 패닝 (스페이스 또는 H 도구)
  const [isPanning, setIsPanning] = useState(false);
  const isPanningRef = useRef(false);
  const isSpaceDownRef = useRef(false);

  // 그라디언트 핸들은 우측 채우기 popover 가 열려 있을 때만 보인다 — store 의
  // isGradientPanelOpen 과 lifetime 공유. part 드래그/변형 시작 시 popover 를 닫으면
  // 핸들도 자연스럽게 사라진다.
  const isGradientPanelOpen = useEditorStore((s) => s.isGradientPanelOpen);
  const setGradientPanelOpen = useEditorStore((s) => s.setGradientPanelOpen);
  // 선택된 그라디언트 stop — 우측 popover Stops 리스트와 공유. 선택 swatch 를 파란색으로 강조.
  const selectedStopIndex = useEditorStore((s) => s.selectedStopIndex);
  const setSelectedStopIndex = useEditorStore((s) => s.setSelectedStopIndex);

  // Figma-스타일 hover — select 도구에서 마우스가 파트(또는 그룹 멤버) 위에 오면 파란 외곽선.
  // 그룹은 멤버 한 명을 hover 해도 전체에 표시되어 클릭 시 일괄 선택될 범위를 미리 알려준다.
  const [hoveredPartIds, setHoveredPartIds] = useState<ReadonlySet<string>>(() => new Set());

  // 마퀴 선택 상태
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  // 마퀴 시작 시점의 Shift 상태 — direct-select 마퀴는 mouseup 까지 결과를 보류하므로
  // 그 사이 키 상태 변화에 영향을 받지 않도록 mousedown 시점 값을 박제한다.
  const marqueeShiftRef = useRef(false);

  // direct-select 다중 앵커 드래그용. dragStart 시점의 selection 스냅샷과 직전 anchor 위치(world).
  // dragMove 마다 delta(=현재 anchor 위치 - 직전 위치)만큼 모든 선택 anchor 를 평행이동.
  const dragAnchorRefsRef = useRef<AnchorRef[] | null>(null);
  const lastDragAnchorPosRef = useRef<{ x: number; y: number } | null>(null);

  // 펜툴 드래프트 — 현재 그리고 있는 part id, 클릭-드래그 시작 좌표(handle_out 산출용).
  const penDraftPartIdRef = useRef<string | null>(null);
  const penDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const penIsDraggingRef = useRef(false);
  // anchor/handle 드래그 1회를 단일 undo 스텝으로 묶기 위한 가드.
  // 드래그 시작 시 true → 첫 dragMove에서 pre-drag 스냅샷이 history에 기록된 직후
  // zundo tracking을 일시 정지(pause)하고 false로 내려둔다. dragEnd에서 resume.
  // (zundo는 set()마다 past를 push하므로 그대로 두면 dragMove 픽셀 수만큼 entry가 쌓여
  //  Ctrl+Z 한 번에 한 픽셀씩만 되돌아가는 문제가 생긴다.)
  const dragHistoryPendingRef = useRef(false);
  // 일러스트레이터식 rubber-band: 마지막 anchor에서 현재 커서까지 미리보기 path를 그릴 때 쓰는 world 좌표.
  // ref 대신 state — 미리보기 Path를 매 mousemove마다 다시 그리려면 React 리렌더가 필요하다.
  const [penPreviewCursor, setPenPreviewCursor] = useState<{ x: number; y: number } | null>(null);

  // 대지 도구 드래그 미리보기. world 좌표 기준의 시작점/현재 사각형.
  const artboardDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [artboardDraft, setArtboardDraft] = useState<MarqueeRect | null>(null);

  // 도형 도구(rect/ellipse) 드래그 미리보기. world 좌표 기준.
  const shapeDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [shapeDraft, setShapeDraft] = useState<MarqueeRect | null>(null);

  // 스냅 가이드 라인. 드래그 중에만 채워지고 dragEnd에서 비워진다. world 좌표.
  // vertical: x가 고정된 세로 가이드, horizontal: y가 고정된 가로 가이드.
  const [snapGuides, setSnapGuides] = useState<{
    vertical: number[];
    horizontal: number[];
  }>({ vertical: [], horizontal: [] });

  // 드래그 시작 시점에 한 번만 계산되는 스냅 후보. dragMove마다 새로 만들면 비싸다.
  // 자기 자신(드래그 중인 파트/대지)은 제외해야 자기-스냅으로 멈추는 일이 없다.
  const snapTargetsRef = useRef<{
    vertical: number[];
    horizontal: number[];
  }>({ vertical: [], horizontal: [] });
  // 스냅 비활성 키(Alt/Option). 사용자가 임시로 자유 이동하고 싶을 때.
  const isAltDownRef = useRef(false);

  // Shift-눌러 드래그 시 축/대각선(45° 단위)로 스냅. 한 번 노드에 attach해야 하므로 ref로 보관.
  const isShiftDownRef = useRef(false);
  // 드래그 시작 시점의 absolute(=화면 pixel) 좌표를 노드 키별로 저장 — dragBoundFunc는
  // absolute 좌표로 입력/출력된다. 키는 part id 또는 artboard id.
  const dragStartAbsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // 컨테이너 크기 추적
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });

  // Arrow 원본 SVG vs parts 렌더 결과를 나란히 보기 위한 디버그 모드.
  // 토글되면 캔버스 영역을 좌(원본)/우(편집)로 분할.
  const [compareMode, setCompareMode] = useState(false);

  // 한 sketch당 한 번만 자동 fit-to-view를 실행하기 위한 가드.
  const lastFittedSketchIdRef = useRef<string | null>(null);
  // 한 sketch당 한 번만 raw_svg 스타일 새로고침을 실행하기 위한 가드.
  const styleRefreshedSketchIdRef = useRef<string | null>(null);
  // 한 sketch당 한 번만 anchors 백필을 실행하기 위한 가드.
  const anchorsBackfilledSketchIdRef = useRef<string | null>(null);
  // 한 sketch당 한 번만 default artboard 시드를 실행하기 위한 가드.
  const defaultArtboardSeededSketchIdRef = useRef<string | null>(null);
  // 한 placeholder sketch 당 한 번만, Arrow 미리보기 viewBox 로 placeholder 사이즈 동기화.
  const previewSizedSketchIdRef = useRef<string | null>(null);

  // 우클릭 컨텍스트 메뉴 — 화면(window) 좌표. null이면 닫힘 상태.
  // kind 별로 노출 항목이 달라진다:
  //   - 'parts'    : 파트(또는 그룹) 위 우클릭. targetIds가 메뉴 열릴 당시 선택 스냅샷.
  //   - 'anchors'  : 직접 선택(A) 도구에서 anchor 위 우클릭. targetRefs가 anchor 선택 스냅샷.
  //                  두 endpoint 가 잡혀 있으면 '연결' 로 두 열린 패스를 이어준다.
  //   - 'artboard' : 대지 배경 위 우클릭(파트 미적중). artboardId가 해당 대지.
  //   - 'empty'    : 어떤 대지에도 들지 않은 빈 영역. UI 숨기기 / 붙여넣기만.
  const [contextMenu, setContextMenu] = useState<
    | { kind: 'parts'; x: number; y: number; targetIds: string[] }
    | { kind: 'anchors'; x: number; y: number; targetRefs: AnchorRef[] }
    | { kind: 'artboard'; x: number; y: number; artboardId: string }
    | { kind: 'empty'; x: number; y: number }
    | null
  >(null);
  // handlePartContextMenu 가 이미 메뉴를 띄웠는지 표시. 동일 이벤트가 wrapper div 의
  // onContextMenu 까지 버블되어 두 번 처리되지 않도록 방지하는 1-tick 가드.
  const partContextMenuHandledRef = useRef(false);
  // hideUI 액션 — 빈/대지 영역 메뉴에서 호출.
  const hideUI = useEditorStore((s) => s.hideUI);
  const toggleHideUI = useEditorStore((s) => s.toggleHideUI);
  // 보기 메뉴/단축키용 — UI 최소화, 눈금자, 그리고 메뉴가 큐에 넣는 뷰포트 명령.
  const toggleUIMinimized = useEditorStore((s) => s.toggleUIMinimized);
  const showRuler = useEditorStore((s) => s.showRuler);
  const toggleRuler = useEditorStore((s) => s.toggleRuler);
  const pendingViewCommand = useEditorStore((s) => s.pendingViewCommand);
  const clearViewCommand = useEditorStore((s) => s.clearViewCommand);
  // Sparkle(AI 생성) 버튼이 토글하는 image input 패널 노출 — fetch 분기 / 파일 선택 / unmount
  // 시점에 명시적으로 켜고 끈다.
  const setImageInputOpen = useEditorStore((s) => s.setImageInputOpen);

  const stageRef = useRef<Konva.Stage>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  // partId → Konva.Path 노드 매핑 (Transformer에 nodes로 전달).
  const pathNodeMap = useRef<Map<string, Konva.Path>>(new Map());
  // partId → 선택 표시(파란 중앙선) 오버레이 노드 매핑. 드래그/변형 중에는 store transform 이
  // 커밋되기 전이라 React 가 오버레이를 재배치하지 않으므로, 메인 Path 의 라이브 transform 을
  // 오버레이 노드에 직접 복사해 즉시 따라오게 한다.
  const selectionOverlayNodeMap = useRef<Map<string, Konva.Path>>(new Map());
  // 대지(Artboard)용 별도 transformer + 노드 매핑. 파트 transformer와 분리해 회전 비활성·
  // boundBoxFunc 등 독립 설정을 두기 위함.
  const artboardTransformerRef = useRef<Konva.Transformer>(null);
  const artboardNodeMap = useRef<Map<string, Konva.Rect>>(new Map());

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);

  // 벡터화 진행 미리보기 (Arrow stream:true).
  // 한 잡당 한 번만 SSE 를 연다 — EventSource 자동 재연결로 인한 중복 호출/credit 낭비 방지.
  // previewAccumulatedRef: Arrow 청크가 누적인지 증분인지 런타임에 판별해 채운다
  // (새 청크가 직전 누적본을 통째로 포함하면 누적=교체, 아니면 증분=append).
  // Arrow 는 토큰 단위(1~6 글자)로 흘려보내므로 청크마다 setState 하면 수천 번
  // 리렌더 → UI 프리즈. ref 에만 누적하고 rAF 로 프레임당 1회만 DOM 에 반영한다.
  const previewSourceRef = useRef<EventSource | null>(null);
  const previewStartedRef = useRef(false);
  const previewAccumulatedRef = useRef('');
  const previewRafRef = useRef<number | null>(null);
  const previewWrapperRef = useRef<HTMLDivElement | null>(null);
  const previewSizeLoggedRef = useRef(false);
  // 파싱된 SVG — element 단위로 분해해 key 매칭으로 mount/reuse 시키기 위한 형태.
  const [previewParsed, setPreviewParsed] = useState<ParsedPreviewSvg | null>(null);
  // 파싱 실패 시 폴백 — 옛 동작(통째 dangerouslySetInnerHTML). 애니메이션은 없지만
  // 적어도 미리보기는 뜬다 (parsePreviewSvg 가 null 을 뱉어도 빈 화면이 되지 않게).
  const [previewSvg, setPreviewSvg] = useState<string | null>(null);
  // Replicate 가 만든 원본 PNG URL — 사용자가 "Replicate 이미지" 버튼으로 새 탭에서 확인.
  const [replicateImageUrl, setReplicateImageUrl] = useState<string | null>(null);

  // ── 컨테이너 크기 추적 ──────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 프로젝트 초기 fetch ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    // 직전 프로젝트의 sketch가 store(싱글톤)에 남아 있으면 좌측 패널/캔버스에 stale 레이어가
    // 그대로 보인다. fetch 시작 직전에 동기적으로 비워 새 프로젝트가 빈 상태에서 시작하도록.
    setSketch(null);
    setPhase({ tag: 'loading' });
    async function fetchProject() {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: { message?: string } }).error?.message ??
              `프로젝트 조회 실패 (${res.status})`,
          );
        }
        const body: ProjectResponse = await res.json();
        const parsed = SketchSchema.safeParse(body.project.sketch);
        if (cancelled) return;
        if (parsed.success) {
          // localStorage draft 복원 — 서버 PATCH 전에 이탈/새로고침해 서버본보다 최신인
          // 로컬 draft 가 있으면 그걸 띄우고, 서버본을 기준선으로 삼아 자동저장이 다시 밀어넣게 한다.
          const draft = loadSketchDraft(projectId);
          const serverUpdatedMs = Date.parse(parsed.data.updated_at ?? '') || 0;
          if (
            draft &&
            draft.savedAt > serverUpdatedMs &&
            JSON.stringify(draft.sketch) !== JSON.stringify(parsed.data)
          ) {
            setSketch(draft.sketch);
            markSketchSynced(parsed.data); // 서버본 기준선 → draft 변경분이 자동저장됨
          } else {
            setSketch(parsed.data);
            // 서버에서 막 받은 sketch는 이미 DB에 있는 상태이므로 자동저장 트리거에서 제외.
            markSketchSynced(parsed.data);
          }
          setPhase({ tag: 'canvas' });
          // 완료된 프로젝트는 image input 닫힌 상태 — Sparkle 버튼으로만 다시 연다.
          setImageInputOpen(false);
        } else {
          // sketch 없음 — 빈 프로젝트로 단정하기 전에 진행 중/완료대기 잡 확인.
          // 있으면 'AI 생성 중' 폴링을 복원 → 나갔다 들어와도 생성 상태가 이어진다.
          // (succeeded 인데 project.sketch 미반영인 경우도 폴링이 signed URL 로
          //  즉시 캔버스 로드하므로 동일 경로로 회수된다.)
          let resumed = false;
          try {
            const jr = await fetch(
              `/api/jobs?project_id=${projectId}&limit=1`,
            );
            if (!cancelled && jr.ok) {
              const { jobs } = (await jr.json()) as {
                jobs: { id: string; status: string }[];
              };
              const latest = jobs[0];
              if (
                latest &&
                latest.status !== 'failed' &&
                latest.status !== 'canceled'
              ) {
                resumed = true;
                if (cancelled) return;
                // 잡 결과를 기다리는 동안 대지1 placeholder 를 먼저 띄우고 캔버스 단계로 진입.
                // 'loading' 풀스크린 오버레이 대신, 대지 안쪽에 미리보기를 띄우기 위함.
                const placeholder = createPlaceholderSketch();
                setSketch(placeholder);
                markSketchSynced(placeholder); // placeholder 는 자동저장에서 제외
                setJobId(latest.id);
                startPolling(latest.id);
                setPhase({ tag: 'canvas' });
              }
            }
          } catch {
            // 잡 조회 실패는 치명적이지 않음 — 업로드 화면으로 폴백.
          }
          if (cancelled) return;
          if (!resumed) {
            setPhase({ tag: 'upload' });
            // 첫 진입 — Sparkle 버튼이 눌린 상태 + image input 펼침으로 시작.
            setImageInputOpen(true);
          }
        }
      } catch (err) {
        if (cancelled) return;
        setPhase({
          tag: 'error',
          message: err instanceof Error ? err.message : '알 수 없는 오류',
        });
      }
    }
    fetchProject();
    return () => {
      cancelled = true;
      // 다른 프로젝트로 이동(또는 unmount)했을 때 stale 한 imageInputOpen=true 가 남지 않도록.
      setImageInputOpen(false);
    };
    // startPolling 은 아래에서 const 선언(useCallback)이라 deps 배열(렌더 중 평가)에
    // 넣으면 TDZ ReferenceError. effect 본문은 commit 후 실행이라 참조는 안전 →
    // deps 에서 의도적으로 제외(startPolling 은 stable useCallback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, setSketch, markSketchSynced, setImageInputOpen]);

  // ── 외부 벡터 임포트 시 업로드 단계 → 캔버스 단계 전환 ──
  // 로고 메뉴의 "파일 가져오기"가 빈 프로젝트에서 .ai/.pdf/.svg 를 흡수하면 store 가
  // 스케치를 만들고 parts 를 채운다. phase 는 canvas-panel 로컬 상태라 이를 감지해
  // 풀스크린 UploadPhase 를 닫고 캔버스로 들어간다. placeholder(parts=0)는 건드리지 않는다.
  useEffect(() => {
    if (phase.tag !== 'upload') return;
    if (sketch && sketch.parts.length > 0) {
      setPhase({ tag: 'canvas' });
      setImageInputOpen(false);
    }
  }, [phase.tag, sketch, setImageInputOpen]);

  // ── raw_svg 흡수 — 처음 로드되거나 새로 생성된 직후 한 번 ──
  // sketch가 raw_svg만 가진 상태면 클라이언트에서 파싱해 parts로 변환,
  // 그 결과를 store에 영구 반영. 이후 편집은 parts 단위로 일어남.
  useEffect(() => {
    if (!sketch) return;
    if (sketch.parts.length === 0 && sketch.raw_svg) {
      ingestRawSvgAsParts();
    }
  }, [sketch, ingestRawSvgAsParts]);

  // ── 과거 파서로 저장된 stale 스타일 자동 복구 ──
  // 예전에는 svg-to-parts.ts가 <style>의 .cls-N 룰을 못 읽어 stroke-width fallback 1.5,
  // dasharray 누락으로 저장됐다. 그 프로젝트들을 다시 열면 raw_svg를 현재 파서로
  // 다시 읽어 매 파트의 스타일 필드를 갱신 — transform/anchors 같은 사용자 편집은 그대로 둔다.
  // sketch_id가 바뀌는 순간(첫 로드/다른 프로젝트 진입)에만 한 번 실행.
  useEffect(() => {
    if (!sketch?.raw_svg) return;
    if (sketch.parts.length === 0) return;
    if (styleRefreshedSketchIdRef.current === sketch.sketch_id) return;
    styleRefreshedSketchIdRef.current = sketch.sketch_id;
    refreshPartStylesFromRawSvg();
  }, [sketch, refreshPartStylesFromRawSvg]);

  // ── 앵커 백필 — 앵커 편집 기능이 추가되기 전에 만들어진 파트는 anchors=[]로 저장돼 있어
  // 오버레이가 안 보인다. raw_svg를 다시 파싱해 빈 anchors만 채워주고, 사용자 편집은 보존.
  // 한 sketch당 한 번만 실행해 무한 루프(action → sketch 갱신 → effect)를 막는다.
  useEffect(() => {
    if (!sketch?.raw_svg) return;
    if (sketch.parts.length === 0) return;
    if (anchorsBackfilledSketchIdRef.current === sketch.sketch_id) return;
    anchorsBackfilledSketchIdRef.current = sketch.sketch_id;
    backfillAnchorsFromRawSvg();
  }, [sketch, backfillAnchorsFromRawSvg]);

  // ── 대지1 자동 시드 ──
  // AI 생성 도식화가 올라간 캔버스를 별도 조작 없이 곧바로 "대지1"로 인식되게 한다.
  // artboards가 비어 있고 화면에 그려질 콘텐츠(parts 또는 raw_svg)가 있을 때만 1회 시드.
  // 이후 사용자가 명시적으로 삭제했다가 같은 세션에서 다시 추가/수정하는 흐름은 가드가 막는다.
  useEffect(() => {
    if (!sketch) return;
    if (defaultArtboardSeededSketchIdRef.current === sketch.sketch_id) return;
    const hasContent = sketch.parts.length > 0 || !!sketch.raw_svg;
    if (!hasContent) return;
    if ((sketch.artboards ?? []).length > 0) {
      defaultArtboardSeededSketchIdRef.current = sketch.sketch_id;
      return;
    }
    defaultArtboardSeededSketchIdRef.current = sketch.sketch_id;
    seedDefaultArtboardFromCanvas();
  }, [sketch, seedDefaultArtboardFromCanvas]);

  // ── Arrow 미리보기 viewBox → placeholder 사이즈 동기화 ──
  // placeholder 는 800×1000 고정으로 만들어지지만 Arrow 결과의 viewBox 는 보통 그와 다르다
  // (예: 960×1104). 그대로 두면 스트리밍 미리보기가 800×1000 박스에 letterbox 되고, 실제
  // sketch 가 도착해 canvas 가 재계산되는 순간 캔버스가 점프한다.
  // 첫 파싱 성공 1회만, placeholder 의 canvas/artboard 치수를 viewBox 와 맞추고 fit 가드를
  // 풀어 viewport 도 재정렬 — 이후 실제 sketch 가 같은 viewBox 로 도착하면 점프 없이 그대로 이어진다.
  useEffect(() => {
    if (!sketch) return;
    if (!previewParsed?.viewBox) return;
    // placeholder 단계에서만 — 실제 sketch (parts > 0 또는 raw_svg) 가 들어오면 무시.
    if (sketch.parts.length > 0 || sketch.raw_svg) return;
    if (previewSizedSketchIdRef.current === sketch.sketch_id) return;

    // viewBox = "min-x min-y width height"
    const parts = previewParsed.viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length < 4) return;
    const vbW = parts[2];
    const vbH = parts[3];
    if (!Number.isFinite(vbW) || !Number.isFinite(vbH) || vbW <= 0 || vbH <= 0) return;
    // 이미 같은 치수면 setSketch 로 인한 불필요한 리렌더/재fit 회피.
    if (sketch.canvas.width === vbW && sketch.canvas.height === vbH) {
      previewSizedSketchIdRef.current = sketch.sketch_id;
      return;
    }

    previewSizedSketchIdRef.current = sketch.sketch_id;
    const next: Sketch = {
      ...sketch,
      canvas: { width: vbW, height: vbH },
      artboards: (sketch.artboards ?? []).map((ab, i) =>
        i === 0 ? { ...ab, x: 0, y: 0, width: vbW, height: vbH } : ab,
      ),
    };
    setSketch(next);
    // placeholder 는 자동저장 baseline 으로 박제해 PATCH 가 나가지 않게 한다 (createPlaceholderSketch 와 동일 정책).
    markSketchSynced(next);
    // 새 치수에 맞춰 viewport 재fit.
    lastFittedSketchIdRef.current = null;
  }, [sketch, previewParsed, setSketch, markSketchSynced]);

  // raw_svg가 여전히 남아있다면 (파싱 실패 케이스) KonvaImage 폴백.
  // parts가 흡수된 후에도 raw_svg는 보존되지만, parts가 1개 이상이면 렌더 분기에서 제외된다.
  useEffect(() => {
    if (!sketch?.raw_svg || sketch.parts.length > 0) {
      setKonvaImage(null);
      return;
    }
    const dataUrl = svgToDataUrl(sketch.raw_svg);
    if (!dataUrl) return;
    const img = new window.Image();
    img.onload = () => setKonvaImage(img);
    img.onerror = () => setKonvaImage(null);
    img.src = dataUrl;
  }, [sketch]);

  // 비교 뷰가 토글되면 가용 영역(절반/전체)이 달라지므로 fit 가드를 초기화해 재정렬을 유도.
  useEffect(() => {
    lastFittedSketchIdRef.current = null;
  }, [compareMode]);

  // ── 새 sketch 로드 시 캔버스를 viewport 가운데에 자동 정렬 ──
  // sketch_id 단위로 한 번만 실행 — 사용자가 이후 패닝/줌한 결과를 덮어쓰지 않는다.
  // 새 도식화가 생성되면 sketch_id가 바뀌므로 다시 한 번 자동 fit이 발동한다.
  useEffect(() => {
    if (!sketch) return;
    if (containerSize.width <= 0 || containerSize.height <= 0) return;
    if (lastFittedSketchIdRef.current === sketch.sketch_id) return;
    // 캔버스가 아직 phase에 도달하지 못했으면 스킵 (Stage 미장착 시 fit 의미 없음).
    if (phase.tag !== 'canvas') return;
    // raw_svg → parts ingestion이 끝나야 sketch.canvas가 SVG 실제 viewBox로 갱신된다.
    // 그 전에 fit하면 placeholder 800×1000 기준으로 계산돼 곧장 어긋난다.
    // 단, raw_svg 없이 parts 만 비어 있는 placeholder sketch (업로드 직후 대지1 표시용)는
    // canvas 가 이미 정답이라 fit 가능 — 안 그러면 대지가 화면 밖에 떠 있을 수 있다.
    if (sketch.raw_svg && sketch.parts.length === 0) return;
    // 분할 비교 뷰에서는 우측 절반이 실제 가용 영역.
    const stageWidth = compareMode ? containerSize.width / 2 : containerSize.width;
    const stageHeight = containerSize.height;

    const availableW = Math.max(1, stageWidth - FIT_PADDING * 2);
    const availableH = Math.max(1, stageHeight - FIT_PADDING * 2);
    const fitZoom = Math.min(
      MAX_ZOOM,
      Math.max(
        MIN_ZOOM,
        Math.min(availableW / sketch.canvas.width, availableH / sketch.canvas.height),
      ),
    );
    const x = (stageWidth - sketch.canvas.width * fitZoom) / 2;
    const y = (stageHeight - sketch.canvas.height * fitZoom) / 2;

    setViewport({ x, y, zoom: fitZoom });
    lastFittedSketchIdRef.current = sketch.sketch_id;
  }, [sketch, containerSize, phase.tag, compareMode, setViewport]);

  // ── 폴링 클린업 ──────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (previewSourceRef.current) {
      previewSourceRef.current.close();
      previewSourceRef.current = null;
    }
    if (previewRafRef.current !== null) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── job 폴링 ────────────────────────────────────────────
  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      setJobStatus('running');
      pollStartRef.current = Date.now();
      // 새 잡 시작 — 미리보기 상태 초기화.
      previewStartedRef.current = false;
      previewAccumulatedRef.current = '';
      previewSizeLoggedRef.current = false;
      setPreviewParsed(null);
      setPreviewSvg(null);
      setReplicateImageUrl(null);

      pollTimerRef.current = setInterval(async () => {
        if (Date.now() - pollStartRef.current > POLL_TIMEOUT_MS) {
          stopPolling();
          clearGenJob(projectId);
          setJobStatus('error');
          setPhase({
            tag: 'error',
            message: 'AI 생성 시간이 초과되었습니다. 다시 시도해 주세요.',
          });
          return;
        }
        try {
          const res = await fetch(`/api/jobs/${id}`);
          if (!res.ok) return;
          const body: JobResponse = await res.json();
          const { status, sketch_signed_url, error_message } = body.job;

          // 진행 중 생성 작업 상태를 sessionStorage 에 보존 (탭 단위 휘발성).
          saveGenJob(projectId, { jobId: id, status, startedAt: pollStartRef.current });

          // Replicate 결과 PNG URL — webhook 이 채워주는 즉시 노출. canvas/loading 모든 단계
          // 에서 "Replicate 이미지" 버튼이 새 탭으로 띄울 수 있게.
          if (body.job.output_image_url) {
            setReplicateImageUrl(body.job.output_image_url);
          }

          // 벡터화는 Replicate webhook 안에서 Quiver Arrow API 로 동기 처리되어 sketches 버킷에
          // SVG 로 저장된다. 클라이언트는 폴링으로 'vectorizing' 동안 스피너를 유지하다가
          // 'succeeded' 에서 sketch_signed_url 로 결과 SVG 를 로드한다.

          if (status === 'failed' || status === 'error') {
            stopPolling();
            clearGenJob(projectId);
            setJobStatus('error');
            setPhase({
              tag: 'error',
              message: error_message ?? 'AI 생성에 실패했습니다.',
            });
            return;
          }

          if (status === 'succeeded' && sketch_signed_url) {
            stopPolling();
            try {
              const svgRes = await fetch(sketch_signed_url);
              if (!svgRes.ok) throw new Error('SVG 파일 다운로드 실패');
              const svgText = await svgRes.text();

              const now = new Date().toISOString();
              const fallbackSketch: Sketch = {
                schema_version: '1.0.0',
                sketch_id: crypto.randomUUID(),
                garment_type: 'other',
                view: 'front',
                canvas: { width: 800, height: 1000 },
                parts: [],
                raw_svg: svgText,
                annotations: [],
                artboards: [],
                group_names: {},
                group_parents: {},
                brush_definitions: [],
                created_at: now,
                updated_at: now,
              };
              const parsed = SketchSchema.safeParse(fallbackSketch);
              if (parsed.success) {
                setSketch(parsed.data);
                setJobStatus('done');
                clearGenJob(projectId);
                setPhase({ tag: 'canvas' });
              } else {
                throw new Error('스케치 스키마 검증 실패');
              }
            } catch (fetchErr) {
              setJobStatus('error');
              setPhase({
                tag: 'error',
                message:
                  fetchErr instanceof Error
                    ? fetchErr.message
                    : 'SVG 로드에 실패했습니다.',
              });
            }
          }
        } catch {
          // 일시적 네트워크 오류 — 다음 사이클 재시도
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, setSketch, setJobStatus, projectId],
  );

  // ── 업로드 + generate ────────────────────────────────────
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // ImageInputPanel 이 자체 모션 후 위임하지만, store 플래그도 명시적으로 닫아 두어
      // 폴링 중 / 캔버스 단계에서 같은 패널이 다시 열리지 않도록 한다.
      setImageInputOpen(false);
      // 잡이 끝나기 전부터 대지1 placeholder 를 띄워두고, 그 위에 진행 미리보기가
      // 겹쳐 보이도록 캔버스 단계로 곧장 진입. 실제 SVG 가 도착하면 sketch 가 통째 교체된다.
      const placeholder = createPlaceholderSketch();
      setSketch(placeholder);
      markSketchSynced(placeholder); // placeholder 는 자동저장 baseline 으로 박제 — PATCH 방지
      setPhase({ tag: 'canvas' });
      setJobStatus('pending');
      try {
        const supabase = createClient();
        const presignRes = await fetch('/api/uploads/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, content_type: file.type }),
        });
        if (!presignRes.ok) throw new Error('업로드 URL 발급에 실패했습니다.');
        const presign = (await presignRes.json()) as {
          bucket: string;
          path: string;
          token: string;
          signed_url: string;
        };
        const { error: uploadError } = await supabase.storage
          .from(presign.bucket)
          .uploadToSignedUrl(presign.path, presign.token, file, {
            contentType: file.type || 'application/octet-stream',
          });
        if (uploadError) throw new Error(`파일 업로드 실패: ${uploadError.message}`);
        const generateRes = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'image_to_sketch',
            project_id: projectId,
            input: { source_path: presign.path },
          }),
        });
        if (!generateRes.ok) {
          const body = await generateRes.json().catch(() => ({}));
          const serverMessage = (body as { error?: { message?: string } }).error?.message;
          throw new Error(
            serverMessage
              ? `AI 생성 요청에 실패했습니다: ${serverMessage}`
              : `AI 생성 요청에 실패했습니다 (${generateRes.status})`,
          );
        }
        const { job_id } = (await generateRes.json()) as { job_id: string };
        setJobId(job_id);
        // 진행 중 생성 작업을 sessionStorage 에 기록 (탭 단위) — 폴링이 상태를 갱신/정리한다.
        saveGenJob(projectId, { jobId: job_id, status: 'processing', startedAt: Date.now() });
        startPolling(job_id);
        // phase 는 이미 'canvas' — placeholder 대지 위에 폴링이 미리보기를 띄운다.
      } catch (err) {
        setJobStatus('error');
        setPhase({
          tag: 'error',
          message: err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.',
        });
      }
    },
    [projectId, startPolling, setJobStatus, setImageInputOpen, setSketch, markSketchSynced],
  );

  // ── 줌 ──────────────────────────────────────────────────
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const oldZoom = viewport.zoom;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const direction = e.evt.deltaY < 0 ? 1 : -1;
      const newZoom = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, oldZoom * Math.pow(ZOOM_SENSITIVITY, direction)),
      );
      const mousePointTo = {
        x: (pointer.x - viewport.x) / oldZoom,
        y: (pointer.y - viewport.y) / oldZoom,
      };
      setViewport({
        x: pointer.x - mousePointTo.x * newZoom,
        y: pointer.y - mousePointTo.y * newZoom,
        zoom: newZoom,
      });
    },
    [viewport, setViewport],
  );

  // ── 패닝 ───────────────────────────────────────────────
  // Space는 일시 패닝, H 도구는 지속 패닝.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        isSpaceDownRef.current = true;
        isPanningRef.current = true;
        setIsPanning(true);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') {
        isSpaceDownRef.current = false;
        if (activeTool !== 'pan') {
          isPanningRef.current = false;
          setIsPanning(false);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [activeTool]);

  // 도구 변경 시 패닝 모드 동기화.
  useEffect(() => {
    const shouldPan = activeTool === 'pan' || isSpaceDownRef.current;
    isPanningRef.current = shouldPan;
    setIsPanning(shouldPan);
  }, [activeTool]);

  // ── Shift-눌러 드래그 축 스냅 ─────────────────────────────
  // 단순 ref 추적 — dragBoundFunc 안에서만 읽어 90°/45° 스냅 분기에 쓰인다.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Shift') isShiftDownRef.current = true;
      if (e.key === 'Alt') isAltDownRef.current = true;
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Shift') isShiftDownRef.current = false;
      if (e.key === 'Alt') isAltDownRef.current = false;
    }
    function onBlur() {
      isShiftDownRef.current = false;
      isAltDownRef.current = false;
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // dragBoundFunc 헬퍼 — shift가 눌려 있으면 드래그 시작점 기준으로 8방향(45°)에 스냅.
  // 입력/반환 모두 absolute(stage 절대) 좌표.
  const snapDragToAxis = useCallback(
    (key: string, pos: { x: number; y: number }) => {
      if (!isShiftDownRef.current) return pos;
      const start = dragStartAbsRef.current.get(key);
      if (!start) return pos;
      const dx = pos.x - start.x;
      const dy = pos.y - start.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0) return pos;
      const step = Math.PI / 4; // 45°
      const snapped = Math.round(Math.atan2(dy, dx) / step) * step;
      return {
        x: start.x + Math.cos(snapped) * dist,
        y: start.y + Math.sin(snapped) * dist,
      };
    },
    [],
  );

  // 드래그 시작 시 호출 — 자기 자신을 제외한 모든 파트/대지의 edge·center 좌표를
  // world 기준 vertical(x값)·horizontal(y값) 라인 후보로 누적. 캔버스 자체 외곽도 포함.
  const buildSnapTargets = useCallback(
    (excludePartIds: Set<string>, excludeArtboardId: string | null) => {
      const verticals: number[] = [];
      const horizontals: number[] = [];
      const s = sketch;
      if (s) {
        // 캔버스 외곽 — 시각적 안정점.
        verticals.push(0, s.canvas.width / 2, s.canvas.width);
        horizontals.push(0, s.canvas.height / 2, s.canvas.height);
        for (const p of s.parts) {
          if (excludePartIds.has(p.id)) continue;
          const t = p.transform ?? DEFAULT_TRANSFORM;
          const sx = Math.abs(t.scaleX || 1);
          const sy = Math.abs(t.scaleY || 1);
          const wx = p.bounding_box.x * sx + t.x;
          const wy = p.bounding_box.y * sy + t.y;
          const ww = p.bounding_box.width * sx;
          const wh = p.bounding_box.height * sy;
          verticals.push(wx, wx + ww / 2, wx + ww);
          horizontals.push(wy, wy + wh / 2, wy + wh);
        }
        for (const ab of s.artboards ?? []) {
          if (excludeArtboardId === ab.id) continue;
          verticals.push(ab.x, ab.x + ab.width / 2, ab.x + ab.width);
          horizontals.push(ab.y, ab.y + ab.height / 2, ab.y + ab.height);
        }
      }
      return { vertical: verticals, horizontal: horizontals };
    },
    [sketch],
  );

  // 드래그된 노드의 absolute(컨테이너 픽셀) 좌표를 받아 스냅 보정된 absolute 좌표 + 표시할
  // 가이드(world 좌표) 반환. 박스 정보는 world 기준의 left/top/width/height. Alt가 눌려 있으면
  // 스냅 비활성. 임계값은 화면 픽셀 6 — viewport.zoom으로 나눠 world 임계값으로 변환.
  const snapDragWithGuides = useCallback(
    (
      posAbs: { x: number; y: number },
      worldStartTransform: { x: number; y: number },
      localBox: { x: number; y: number; width: number; height: number },
      scale: { sx: number; sy: number },
    ): { posAbs: { x: number; y: number }; guides: { vertical: number[]; horizontal: number[] } } => {
      if (isAltDownRef.current) return { posAbs, guides: { vertical: [], horizontal: [] } };
      const targets = snapTargetsRef.current;
      if (targets.vertical.length === 0 && targets.horizontal.length === 0) {
        return { posAbs, guides: { vertical: [], horizontal: [] } };
      }
      // absolute → world. Stage.x = viewport.x, Stage.scaleX = viewport.zoom.
      const worldX = (posAbs.x - viewport.x) / viewport.zoom;
      const worldY = (posAbs.y - viewport.y) / viewport.zoom;
      // 드래그된 파트의 world bbox edges/center — transform.x가 위 worldX 그대로라 간단.
      // (Konva의 node.x()는 우리 transform.x와 동일하게 다뤄지므로)
      void worldStartTransform;
      const worldBoxLeft = worldX + localBox.x * scale.sx;
      const worldBoxTop = worldY + localBox.y * scale.sy;
      const worldBoxW = localBox.width * scale.sx;
      const worldBoxH = localBox.height * scale.sy;
      const candX: { sourceWorld: number; offset: number }[] = [
        { sourceWorld: worldBoxLeft, offset: 0 },
        { sourceWorld: worldBoxLeft + worldBoxW / 2, offset: worldBoxW / 2 },
        { sourceWorld: worldBoxLeft + worldBoxW, offset: worldBoxW },
      ];
      const candY: { sourceWorld: number; offset: number }[] = [
        { sourceWorld: worldBoxTop, offset: 0 },
        { sourceWorld: worldBoxTop + worldBoxH / 2, offset: worldBoxH / 2 },
        { sourceWorld: worldBoxTop + worldBoxH, offset: worldBoxH },
      ];
      const thresholdWorld = 6 / viewport.zoom;
      let bestX: { target: number; cand: { sourceWorld: number; offset: number } } | null = null;
      let bestXDist = thresholdWorld;
      for (const c of candX) {
        for (const t of targets.vertical) {
          const d = Math.abs(c.sourceWorld - t);
          if (d < bestXDist) {
            bestXDist = d;
            bestX = { target: t, cand: c };
          }
        }
      }
      let bestY: { target: number; cand: { sourceWorld: number; offset: number } } | null = null;
      let bestYDist = thresholdWorld;
      for (const c of candY) {
        for (const t of targets.horizontal) {
          const d = Math.abs(c.sourceWorld - t);
          if (d < bestYDist) {
            bestYDist = d;
            bestY = { target: t, cand: c };
          }
        }
      }
      const guides = {
        vertical: bestX ? [bestX.target] : [],
        horizontal: bestY ? [bestY.target] : [],
      };
      let snappedWorldX = worldX;
      let snappedWorldY = worldY;
      if (bestX) {
        // worldX' + (cand.offset + localBox.x*sx) = bestX.target
        snappedWorldX = bestX.target - bestX.cand.offset - localBox.x * scale.sx;
      }
      if (bestY) {
        snappedWorldY = bestY.target - bestY.cand.offset - localBox.y * scale.sy;
      }
      return {
        posAbs: {
          x: snappedWorldX * viewport.zoom + viewport.x,
          y: snappedWorldY * viewport.zoom + viewport.y,
        },
        guides,
      };
    },
    [viewport.x, viewport.y, viewport.zoom],
  );

  // 가이드 변경을 React state로 반영. dragBoundFunc 내에서 직접 setState 하면 매 프레임
  // 호출돼 부담스러울 수 있어 라스트값과 비교해 변동 시에만 setState.
  const lastGuidesRef = useRef<{ vertical: number[]; horizontal: number[] }>({
    vertical: [],
    horizontal: [],
  });
  const applyGuides = useCallback((g: { vertical: number[]; horizontal: number[] }) => {
    const last = lastGuidesRef.current;
    const same =
      last.vertical.length === g.vertical.length &&
      last.horizontal.length === g.horizontal.length &&
      last.vertical.every((v, i) => v === g.vertical[i]) &&
      last.horizontal.every((v, i) => v === g.horizontal[i]);
    if (same) return;
    lastGuidesRef.current = g;
    setSnapGuides(g);
  }, []);

  // ── 펜툴: 활성 시 cursor=crosshair, 도구가 바뀌면 드래프트 자동 종료 ──────
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (activeTool !== 'pen') {
      // 다른 도구로 전환: 그리던 드래프트는 그대로 살려두되 펜 ref는 비워서 다음 펜 진입은 새 path로.
      penDraftPartIdRef.current = null;
      penDragStartRef.current = null;
      penIsDraggingRef.current = false;
      setPenPreviewCursor(null);
      return;
    }
    const container = stage.container();
    const prev = container.style.cursor;
    // floating-toolbar PenTool(lucide)와 매칭되는 펜 SVG.
    // SVG는 22x22로 래스터(viewBox 0 0 24 24).
    container.style.cursor = 'url("/cursor-pen.svg") 2 2, crosshair';
    return () => {
      container.style.cursor = prev;
    };
  }, [activeTool, phase.tag]);

  // ── 대지 / 도형(rect·ellipse) 공통 십자 커서 ───────────────
  // 동일 SVG(cursor-artboard.svg, 14px)를 공유. hotspot은 중앙 (7,7).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (activeTool !== 'artboard' && activeTool !== 'rect' && activeTool !== 'ellipse') return;
    const container = stage.container();
    const prev = container.style.cursor;
    container.style.cursor = 'url("/cursor-artboard.svg") 7 7, crosshair';
    return () => {
      container.style.cursor = prev;
    };
  }, [activeTool, phase.tag]);

  // ── 줌 도구 cursor 동기화 ─────────────────────────────────
  // 줌 도구일 때 stage container의 cursor를 zoom-in으로, Alt를 누르고 있으면 zoom-out으로.
  // 줌이 아닌 도구에서는 아무것도 안 한다 — 직전 effect 호출의 cleanup이 cursor=''로 복귀시키고,
  // 그 다음 단계의 cursor는 펜 effect 또는 select/direct-select unified effect가 책임진다.
  // (이전엔 여기서 직접 cursor=''를 강제 초기화해 펜·직접선택 effect가 막 설정한 커서를 덮어썼다.)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (activeTool !== 'zoom') return;
    const container = stage.container();
    // floating-toolbar의 ZoomIn/ZoomOut(lucide) 아이콘과 매칭되는 커스텀 SVG.
    // hotspot은 렌즈 중심 — 22-px space (10,10). Alt 누르면 zoom-out.
    const apply = (alt: boolean) => {
      container.style.cursor = alt
        ? 'url("/cursor-zoom-out.svg") 10 10, zoom-out'
        : 'url("/cursor-zoom-in.svg") 10 10, zoom-in';
    };
    apply(false);
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Alt') apply(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Alt') apply(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      container.style.cursor = '';
    };
  }, [activeTool, phase.tag]);

  // ── select / direct-select / pan + space-hold cursor ──────────────────────
  // 펜·줌은 위 effect들이 자체적으로 cursor를 잡고 있다. 여기서는 isPanning(스페이스
  // 또는 pan 도구)일 때 'grab'으로 임시 override하고, 나머지 select/direct-select에는
  // 기본 화살표를 적용한다. 펜/줌이 active일 때는 isPanning이 true가 아니면 건드리지
  // 않아 그쪽 effect의 cursor가 유지된다.
  // phase.tag도 의존성에 포함 — Stage가 'canvas' phase에서 처음 마운트될 때 한 번 더 돌아
  // 첫 페이지 진입에서도 도구를 클릭하지 않고 즉시 select 커서가 적용된다.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const container = stage.container();
    if (isPanning) {
      const prev = container.style.cursor;
      // floating-toolbar Hand(lucide) 매칭 SVG. 22-px space hotspot (11,11).
      container.style.cursor = 'url("/cursor-pan.svg") 11 11, grab';
      return () => {
        container.style.cursor = prev;
      };
    }
    if (
      activeTool === 'pen' ||
      activeTool === 'zoom' ||
      activeTool === 'artboard' ||
      activeTool === 'rect' ||
      activeTool === 'ellipse'
    )
      return;
    // floating-toolbar lucide 아이콘과 매칭되는 SVG 커서. 22-px space.
    if (activeTool === 'direct-select') {
      container.style.cursor = 'url("/cursor-direct-select.svg") 4 3, default';
    } else if (activeTool === 'eyedropper') {
      // 전용 스포이드 커서 에셋이 없어 crosshair 로 "찍는" 동작을 표현.
      container.style.cursor = 'crosshair';
    } else {
      container.style.cursor = 'url("/cursor-select.svg") 4 4, default';
    }
    return () => {
      container.style.cursor = '';
    };
  }, [activeTool, isPanning, phase.tag]);

  // select 도구가 아니거나 패닝 중이면 hover 표시를 해제 — 다른 도구로 전환했는데 잔상이
  // 남아 있는 것을 막는다.
  useEffect(() => {
    if ((activeTool !== 'select' && activeTool !== 'eyedropper') || isPanning) {
      setHoveredPartIds((prev) => (prev.size === 0 ? prev : new Set()));
    }
  }, [activeTool, isPanning]);

  // Konva의 drag 이벤트는 자식 노드(Path, anchor Rect 등)에서 발생해도 Stage로 버블링된다.
  // e.target이 Stage가 아니면 자식 드래그라는 뜻이므로 stage 패닝 로직을 적용하면 안 된다.
  // 가드 없이 stopDrag/position 리셋을 돌리면 자식 노드가 (0,0)으로 점프하고 viewport도
  // 자식의 로컬 좌표로 덮어써져서 "대지가 왼쪽 위로 튀고 오브젝트가 안 움직이는" 증상이 난다.
  const handleStageDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    if (e.target !== e.target.getStage()) return;
    if (!isPanningRef.current) e.target.stopDrag();
  }, []);

  const handleStageDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (e.target !== e.target.getStage()) return;
      const stage = e.target as Konva.Stage;
      const newX = stage.x();
      const newY = stage.y();
      stage.position({ x: 0, y: 0 });
      setViewport({ x: newX, y: newY, zoom: viewport.zoom });
    },
    [viewport.zoom, setViewport],
  );

  // Konva 노드의 절대 변환을 역으로 적용해 stage 포인터 좌표를 part-로컬(=anchor.x/y) 좌표로 변환.
  // Konva가 viewport scale + part transform(group)까지 모두 누적해 두기 때문에 한 번의 invert로 끝난다.
  const partLocalFromPointer = useCallback(
    (node: Konva.Node, stagePointer: Pt): Pt => {
      const t = node.getAbsoluteTransform().copy().invert();
      return t.point(stagePointer);
    },
    [],
  );

  // 펜툴: world 좌표를 *현재 드래프트 파트*의 local 공간으로 변환.
  // 신규 펜 파트는 transform=identity 라 그대로(world==local) 반환 — 기존 동작 보존.
  // 사용자가 옮긴 기존 파트에 이어그리기를 재개한 경우엔 그 파트의 transform 으로 역변환.
  const penWorldToLocal = useCallback((world: Pt): Pt => {
    const id = penDraftPartIdRef.current;
    if (!id) return world;
    const t = useEditorStore.getState().sketch?.parts.find((p) => p.id === id)?.transform;
    if (!t) return world;
    return partWorldToLocal(t, world);
  }, []);

  // 펜툴: world 클릭 위치 근처에 있는 '끊긴(열린) 패스의 끝점'을 찾는다.
  // 닫힌 서브패스엔 끝점이 없고, 잠금/숨김/비편집 파트는 제외. 화면 픽셀 기준 허용 반경 내
  // 가장 가까운 끝점을 반환 — 없으면 null. (anchors 는 part-local 이라 transform 으로 world 화)
  const findResumableEndpoint = useCallback(
    (world: Pt): { partId: string; anchorId: string } | null => {
      const sk = useEditorStore.getState().sketch;
      if (!sk) return null;
      const tolPx = ANCHOR_SIDE_PX * 2;
      let bestPartId: string | null = null;
      let bestAnchorId: string | null = null;
      let bestD = Infinity;
      for (const part of sk.parts) {
        if (part.locked === true || part.visible === false || part.editable === false) continue;
        if (part.anchors.length === 0) continue;
        const t = part.transform ?? DEFAULT_TRANSFORM;
        const breaks = part.subpath_breaks ?? [];
        const closed = part.subpath_closed ?? [];
        const starts = [0, ...breaks];
        for (let i = 0; i < starts.length; i++) {
          const s = starts[i]!;
          const e = i + 1 < starts.length ? starts[i + 1]! : part.anchors.length;
          if (closed[i] === true) continue; // 닫힌 서브패스 — 끝점 없음
          if (e - s < 1) continue;
          const endIdxs = e - s === 1 ? [s] : [s, e - 1];
          for (const idx of endIdxs) {
            const a = part.anchors[idx]!;
            const w = partLocalToWorld(t, a);
            const dx = (w.x - world.x) * viewport.zoom;
            const dy = (w.y - world.y) * viewport.zoom;
            const d = Math.hypot(dx, dy);
            if (d <= tolPx && d < bestD) {
              bestPartId = part.id;
              bestAnchorId = a.id;
              bestD = d;
            }
          }
        }
      }
      return bestPartId && bestAnchorId
        ? { partId: bestPartId, anchorId: bestAnchorId }
        : null;
    },
    [viewport.zoom],
  );

  // 단일 선택된 파트의 모든 세그먼트를 순회하며 클릭에 가장 가까운 세그먼트를 찾는다.
  // 닫힌 서브패스의 닫힘 직선도 포함. 반환값을 그대로 insertAnchor에 전달 가능.
  function findClosestSegment(
    part: Part,
    p: Pt,
  ): { fromIdx: number; toIdx: number; isClosing: boolean; t: number; dist: number } | null {
    const anchors = part.anchors;
    if (anchors.length < 2) return null;
    const breaks = part.subpath_breaks ?? [];
    const closed = part.subpath_closed ?? [];
    const starts = [0, ...breaks];
    const ranges = starts.map((s, i) => {
      const e = i + 1 < starts.length ? starts[i + 1] : anchors.length;
      return [s, e] as [number, number];
    });
    let best: { fromIdx: number; toIdx: number; isClosing: boolean; t: number; dist: number } | null = null;
    ranges.forEach(([s, e], subIdx) => {
      if (e - s < 2) return;
      for (let i = s; i < e - 1; i++) {
        const a0 = anchors[i]!;
        const a1 = anchors[i + 1]!;
        const r = projectOntoSegment(p, a0, a1, a0.handle_out, a1.handle_in);
        if (!best || r.dist < best.dist) {
          best = { fromIdx: i, toIdx: i + 1, isClosing: false, t: r.t, dist: r.dist };
        }
      }
      if (closed[subIdx]) {
        const a0 = anchors[e - 1]!;
        const a1 = anchors[s]!;
        const r = projectOntoSegment(p, a0, a1, a0.handle_out, a1.handle_in);
        if (!best || r.dist < best.dist) {
          best = { fromIdx: e - 1, toIdx: s, isClosing: true, t: r.t, dist: r.dist };
        }
      }
    });
    return best;
  }

  // ── 파트 클릭 ─────────────────────────────────────────────
  const handlePartClick = useCallback(
    (e: Konva.KonvaEventObject<Event>, partId: string) => {
      // Stage 패닝 중에는 무시.
      if (isPanningRef.current) return;
      // Konva 의 'click' 이벤트는 button 구분 없이 mouseup 에서 fire — 우클릭 시에도 호출돼
      // contextmenu 가 띄운 다중 선택 메뉴 직후 selectPart 가 단일 선택으로 덮어써 '한 패스만
      // 선택' 문제를 만들었다. 우/휠 클릭은 contextmenu 분기에서만 처리하므로 여기서 끊는다.
      const mouseEvt = e.evt as Partial<MouseEvent>;
      if (typeof mouseEvt.button === 'number' && mouseEvt.button !== 0) return;
      // 줌/펜/대지 도구 클릭은 각자의 stage 핸들러에서 처리 — 파트 선택 변경 금지.
      if (activeTool === 'zoom' || activeTool === 'pen' || activeTool === 'artboard') return;

      // 스포이드(I): 클릭한 파트가 스타일 소스. 현재 선택된 파트(들)에 그 외형을 복사한다.
      // 선택을 바꾸지 않아 연속으로 다른 소스를 찍어 비교할 수 있다. 대상이 없으면 no-op.
      if (activeTool === 'eyedropper') {
        e.cancelBubble = true;
        if (selectedPartIds.length === 0) return;
        copyStyleFromPart(partId, selectedPartIds);
        return;
      }

      // 직접 선택(A) + 이미 단일 선택된 파트의 패스 본체를 클릭하면 → 그 위에 anchor 삽입.
      if (
        activeTool === 'direct-select' &&
        selectedPartIds.length === 1 &&
        selectedPartIds[0] === partId
      ) {
        const stage = stageRef.current;
        const pointer = stage?.getPointerPosition();
        const node = e.target as Konva.Node;
        const part = sketch?.parts.find((p) => p.id === partId);
        if (stage && pointer && part) {
          const local = partLocalFromPointer(node, pointer);
          const seg = findClosestSegment(part, local);
          if (seg) {
            e.cancelBubble = true;
            insertAnchor(partId, seg.fromIdx, seg.toIdx, seg.isClosing, seg.t);
            return;
          }
        }
      }

      e.cancelBubble = true;
      const evt = e.evt as Partial<MouseEvent>;
      const additive = !!(evt.shiftKey || evt.metaKey || evt.ctrlKey);
      // 그룹 인식: 클릭한 파트가 그룹의 일원이면 같은 그룹의 모든 파트를 한꺼번에 선택.
      // additive(shift)면 기존 선택에 그룹 멤버를 합집합으로 추가.
      const groupMembers = getGroupMemberIds(partId);
      if (groupMembers.length > 1) {
        const next = additive
          ? [...new Set([...selectedPartIds, ...groupMembers])]
          : groupMembers;
        selectMany(next);
        return;
      }
      selectPart(partId, additive);
    },
    [
      activeTool,
      selectPart,
      selectMany,
      selectedPartIds,
      sketch,
      partLocalFromPointer,
      insertAnchor,
      getGroupMemberIds,
      copyStyleFromPart,
    ],
  );

  // ── 우클릭 컨텍스트 메뉴 ──────────────────────────────────
  // Stage가 캔버스 wrapper 안에 있어 브라우저 기본 메뉴(이미지 다운로드 등)가 뜨면
  // 우리 메뉴와 겹친다 — onContextMenu에서 항상 preventDefault.
  const handlePartContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>, partId: string) => {
      // direct-select / pen / artboard 등 다른 도구에서는 우클릭 메뉴를 띄우지 않는다.
      if (activeTool !== 'select') return;
      const evt = e.evt;
      evt.preventDefault();
      e.cancelBubble = true;
      // 클릭한 파트가 현재 선택에 포함돼 있지 않으면 그 파트를 단일 선택으로 갈아끼운다.
      // 그룹 멤버는 함께 선택되도록 보장.
      let nextIds = selectedPartIds;
      if (!selectedPartIds.includes(partId)) {
        const groupMembers = getGroupMemberIds(partId);
        if (groupMembers.length > 1) {
          selectMany(groupMembers);
          nextIds = groupMembers;
        } else {
          selectPart(partId, false);
          nextIds = [partId];
        }
      }
      setContextMenu({ kind: 'parts', x: evt.clientX, y: evt.clientY, targetIds: nextIds });
      // wrapper div onContextMenu 까지 버블 — 거기서 다시 메뉴를 갈아끼우지 않도록 1-tick 가드.
      partContextMenuHandledRef.current = true;
    },
    [activeTool, selectedPartIds, selectPart, selectMany, getGroupMemberIds],
  );

  // anchor 우클릭 — 직접 선택(A) 도구에서만. 두 endpoint 가 선택돼 있으면 '연결' 로 잇는다.
  // 우클릭한 anchor 가 현재 선택에 없으면 그 anchor 단일 선택으로 갈아끼우고 메뉴를 띄운다.
  // 이미 선택돼 있으면 selection 그대로 유지(다중 anchor 선택 후 우클릭 → '연결' 케이스).
  const handleAnchorContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>, partId: string, anchorId: string) => {
      if (activeTool !== 'direct-select') return;
      const evt = e.evt;
      evt.preventDefault();
      e.cancelBubble = true;
      const cur = useEditorStore.getState().selectedAnchors;
      const inSel = cur.some((r) => r.partId === partId && r.anchorId === anchorId);
      let nextRefs: AnchorRef[];
      if (inSel) {
        nextRefs = cur;
      } else {
        selectAnchor(anchorId, partId);
        nextRefs = [{ partId, anchorId }];
      }
      setContextMenu({
        kind: 'anchors',
        x: evt.clientX,
        y: evt.clientY,
        targetRefs: nextRefs,
      });
      partContextMenuHandledRef.current = true;
    },
    [activeTool, selectAnchor],
  );

  // ── 마퀴 (rubber-band) 선택 ───────────────────────────────
  // Stage의 빈 영역 mousedown → drag → mouseup. 드래그 중에는 KonvaImage/Path가
  // listening=false인 영역 또는 Stage 배경을 hit할 때만 시작.
  const stageToWorld = useCallback(
    (point: { x: number; y: number }) => ({
      x: (point.x - viewport.x) / viewport.zoom,
      y: (point.y - viewport.y) / viewport.zoom,
    }),
    [viewport.x, viewport.y, viewport.zoom],
  );

  // 빈 영역 / 파트 미적중 우클릭 — wrapper div 단계에서 처리.
  // Konva Path/Rect 의 onContextMenu 가 먼저 발화해 partContextMenuHandledRef 를 true 로 세웠다면
  // 여기서는 메뉴를 갈아끼우지 않고 가드만 리셋한다.
  const handleWrapperContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (partContextMenuHandledRef.current) {
        partContextMenuHandledRef.current = false;
        return;
      }
      // 캔버스가 아직 마운트되지 않았거나 stage 가 없으면 메뉴 자체를 띄우지 않는다.
      const stage = stageRef.current;
      if (!stage) {
        setContextMenu(null);
        return;
      }
      // V(select) 도구 + 이미 파트가 선택돼 있으면 — Konva Path 히트가 빗나갔어도
      // 사용자 의도는 그 선택에 대한 컨텍스트 메뉴다. fill=none 인 빈 패스 내부 클릭,
      // 패스 사이의 좁은 빈 영역 등에서 '연결' 같은 항목을 못 보는 문제를 막는다.
      if (activeTool === 'select' && selectedPartIds.length > 0) {
        setContextMenu({
          kind: 'parts',
          x: e.clientX,
          y: e.clientY,
          targetIds: selectedPartIds,
        });
        return;
      }
      const containerRect = stage.container().getBoundingClientRect();
      const stageX = e.clientX - containerRect.left;
      const stageY = e.clientY - containerRect.top;
      const world = stageToWorld({ x: stageX, y: stageY });
      // 대지 위인지 확인 — 위에서부터(나중에 그려진 게 위) 역순 탐색.
      const list = artboards ?? [];
      let hitArtboardId: string | null = null;
      for (let i = list.length - 1; i >= 0; i--) {
        const ab = list[i]!;
        if (
          world.x >= ab.x &&
          world.x <= ab.x + ab.width &&
          world.y >= ab.y &&
          world.y <= ab.y + ab.height
        ) {
          hitArtboardId = ab.id;
          break;
        }
      }
      if (hitArtboardId) {
        selectArtboard(hitArtboardId);
        setContextMenu({
          kind: 'artboard',
          x: e.clientX,
          y: e.clientY,
          artboardId: hitArtboardId,
        });
      } else {
        setContextMenu({ kind: 'empty', x: e.clientX, y: e.clientY });
      }
    },
    [activeTool, selectedPartIds, artboards, stageToWorld, selectArtboard],
  );

  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (isPanningRef.current) return;
      // 우클릭(또는 휠클릭) mousedown은 도구 동작을 트리거하지 않는다.
      // 특히 select 모드에서 빈 영역 우클릭이 마퀴 + clearSelection 으로 이어져
      // 다중 선택 상태에서 우클릭하면 선택이 풀리는 문제가 있었다 — contextmenu 단계는
      // handlePartContextMenu / handleWrapperContextMenu 가 별도로 처리한다.
      if (e.evt.button !== 0) return;

      // 펜툴: stage 빈 영역(또는 anchor 위가 아닌 곳) 클릭으로 새 anchor 추가.
      // 첫 번째 anchor 위에서 클릭하면 서브패스가 닫히면서 드래프트 종료.
      if (activeTool === 'pen') {
        const stage = stageRef.current;
        if (!stage) return;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        e.cancelBubble = true;

        // Ctrl/Cmd + 클릭 — 현재 드래프트를 닫지 않고 빠져나옴(open path 유지).
        // 일러스트레이터에서 Ctrl을 누르면 펜이 일시적으로 선택 도구처럼 동작해
        // 빈 영역 클릭으로 path 작성을 끝내는 관례를 따름.
        if (e.evt.ctrlKey || e.evt.metaKey) {
          if (penDraftPartIdRef.current) {
            penDraftPartIdRef.current = null;
            penDragStartRef.current = null;
            penIsDraggingRef.current = false;
            setPenPreviewCursor(null);
          }
          return;
        }

        // 펜 드래프트 좌표는 stage→world(=캔버스 좌표)로 변환. 펜으로 만든 신규 part는
        // transform=identity라 part-local과 캔버스 좌표가 같다. 기존 part에 이어그리기는 안 함(MVP).
        const world = stageToWorld(pointer);

        const draftId = penDraftPartIdRef.current;
        // sketch는 useCallback deps에 없어 closure가 stale — 직전 클릭이 만든 드래프트 파트를
        // 못 찾으면 매 클릭마다 createPenPart로 분기해 anchors=1짜리 새 파트만 양산된다(=path 안 그려짐).
        // store에서 직접 최신 스냅샷을 읽어 안정적으로 조회.
        const currentSketch = useEditorStore.getState().sketch;
        const draftPart = draftId
          ? currentSketch?.parts.find((p) => p.id === draftId)
          : null;

        // 진행 중인 드래프트가 없을 때만: 끊긴(열린) 패스의 끝점을 클릭했는지 먼저 확인.
        // 끝점 근처면 그 파트를 드래프트로 삼아 이어그리기를 재개한다(일러스트레이터 펜 관례).
        if (!draftPart) {
          const hit = findResumableEndpoint(world);
          if (hit) {
            const resumedId = resumePenAtAnchor(hit.partId, hit.anchorId);
            if (resumedId) {
              const t =
                useEditorStore.getState().sketch?.parts.find((p) => p.id === resumedId)
                  ?.transform ?? DEFAULT_TRANSFORM;
              const localStart = partWorldToLocal(t, world);
              penDraftPartIdRef.current = resumedId;
              penDragStartRef.current = localStart;
              penIsDraggingRef.current = true;
              // 클릭 직후 곧장 드래그하면 재개한 끝점에서 out-handle 을 끌어낼 수 있도록
              // 미리보기 커서를 끝점 자체로 둔다.
              setPenPreviewCursor(localStart);
              return;
            }
          }
        }

        // 드래프트 좌표는 해당 파트의 local 공간으로 변환. 신규 펜 파트는 identity 라
        // local==world (= 기존 동작 그대로). 옮긴 파트에 재개한 경우만 실제 역변환된다.
        const local = draftPart ? penWorldToLocal(world) : world;
        const dt = draftPart?.transform ?? DEFAULT_TRANSFORM;

        // 첫 anchor와 클릭 위치가 화면 픽셀 12px 이내면 닫힘으로 간주.
        if (draftPart && draftPart.anchors.length >= 2) {
          const first = draftPart.anchors[0]!;
          const dx = (local.x - first.x) * viewport.zoom * Math.abs(dt.scaleX || 1);
          const dy = (local.y - first.y) * viewport.zoom * Math.abs(dt.scaleY || 1);
          if (Math.hypot(dx, dy) <= 12) {
            closeLastSubpath(draftPart.id);
            penDraftPartIdRef.current = null;
            penDragStartRef.current = null;
            penIsDraggingRef.current = false;
            setPenPreviewCursor(null);
            return;
          }
        }

        if (!draftPart) {
          const id = createPenPart({ x: world.x, y: world.y });
          if (id) {
            penDraftPartIdRef.current = id;
            penDragStartRef.current = { x: world.x, y: world.y };
            penIsDraggingRef.current = true;
          }
        } else {
          appendAnchorToPart(draftPart.id, { x: local.x, y: local.y });
          penDragStartRef.current = { x: local.x, y: local.y };
          penIsDraggingRef.current = true;
        }
        return;
      }

      // 도형 도구(rect/ellipse): 빈 영역 mousedown으로 드래그 시작.
      if (activeTool === 'rect' || activeTool === 'ellipse') {
        if (e.target !== e.target.getStage()) return;
        const stage = stageRef.current;
        if (!stage) return;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        e.cancelBubble = true;
        clearSelection();
        const world = stageToWorld(pointer);
        shapeDragStartRef.current = world;
        setShapeDraft({ x: world.x, y: world.y, width: 0, height: 0 });
        return;
      }

      // 대지 도구: 빈 영역 mousedown으로 새 대지 드래그 시작.
      // 기존 대지 위에서 시작한 mousedown은 그쪽 onMouseDown이 cancelBubble로 가로채므로 여기로 안 옴.
      if (activeTool === 'artboard') {
        if (e.target !== e.target.getStage()) return;
        const stage = stageRef.current;
        if (!stage) return;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        e.cancelBubble = true;
        // 빈 영역 클릭은 기존 대지 선택을 해제.
        selectArtboard(null);
        const world = stageToWorld(pointer);
        artboardDragStartRef.current = world;
        setArtboardDraft({ x: world.x, y: world.y, width: 0, height: 0 });
        return;
      }

      // 줌 도구: Stage 어디든 클릭하면 포인터 기준 배율 변경.
      // 파트 위에서 클릭해도 패스 선택을 유발하지 않도록 cancelBubble.
      if (activeTool === 'zoom') {
        const stage = stageRef.current;
        if (!stage) return;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        e.cancelBubble = true;
        const oldZoom = viewport.zoom;
        const direction = e.evt.altKey ? -1 : 1;
        const factor = direction > 0 ? ZOOM_TOOL_FACTOR : 1 / ZOOM_TOOL_FACTOR;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * factor));
        if (newZoom === oldZoom) return;
        const mousePointTo = {
          x: (pointer.x - viewport.x) / oldZoom,
          y: (pointer.y - viewport.y) / oldZoom,
        };
        setViewport({
          x: pointer.x - mousePointTo.x * newZoom,
          y: pointer.y - mousePointTo.y * newZoom,
          zoom: newZoom,
        });
        return;
      }

      // 선택/직접선택 도구일 때만 마퀴. 직접선택은 마퀴로도 파트를 잡아 앵커 오버레이를 띄울 수 있다.
      if (activeTool !== 'select' && activeTool !== 'direct-select') return;
      // 빈 영역(Stage 자체) 클릭만 마퀴 시작. 파트나 transformer 클릭은 무시.
      if (e.target !== e.target.getStage()) return;

      const stage = stageRef.current;
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const world = stageToWorld(pointer);
      marqueeStartRef.current = world;
      marqueeShiftRef.current = e.evt.shiftKey;
      setMarquee({ x: world.x, y: world.y, width: 0, height: 0 });

      // shift가 아니면 기존 선택 해제. direct-select 모드에선 part 선택은 유지하고
      // anchor 선택만 비운다 — 마퀴 결과로 새 anchor 선택을 만들기 위함.
      if (!e.evt.shiftKey) {
        if (activeTool === 'direct-select') clearAnchorSelection();
        else clearSelection();
      }
    },
    [
      activeTool,
      stageToWorld,
      clearSelection,
      clearAnchorSelection,
      viewport,
      setViewport,
      selectArtboard,
      findResumableEndpoint,
      resumePenAtAnchor,
      penWorldToLocal,
    ],
  );

  const handleStageMouseMove = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    // 펜툴 click-drag: 마우스다운 후 이동하면 직전 anchor의 handle_out + (mirror) handle_in 갱신.
    if (
      activeTool === 'pen' &&
      penIsDraggingRef.current &&
      penDraftPartIdRef.current &&
      penDragStartRef.current
    ) {
      // 드래프트 파트의 local 공간으로 변환 (identity 면 world==local = 기존 동작).
      const local = penWorldToLocal(stageToWorld(pointer));
      const draftT =
        useEditorStore.getState().sketch?.parts.find(
          (p) => p.id === penDraftPartIdRef.current,
        )?.transform ?? DEFAULT_TRANSFORM;
      // 클릭 시작점 대비 이동량이 임계값(픽셀 2px) 이상일 때만 핸들 표기 — 미세한 흔들림은 무시.
      // local 좌표 차에 part scale 과 zoom 둘 다 곱해야 화면 픽셀이 된다.
      const dxPx = (local.x - penDragStartRef.current.x) * viewport.zoom * Math.abs(draftT.scaleX || 1);
      const dyPx = (local.y - penDragStartRef.current.y) * viewport.zoom * Math.abs(draftT.scaleY || 1);
      if (Math.hypot(dxPx, dyPx) >= 2) {
        setLastAnchorHandleOut(penDraftPartIdRef.current, local, true);
      }
      // 드래그 중에도 cursor 위치를 갱신해두면 mouseup 직후 자연스럽게 rubber-band가 이어진다.
      setPenPreviewCursor(local);
      return;
    }

    // 펜툴 idle (드래프트 진행 중, 드래그 아님): 마지막 anchor → 커서까지 rubber-band 미리보기 갱신.
    if (activeTool === 'pen' && penDraftPartIdRef.current) {
      setPenPreviewCursor(penWorldToLocal(stageToWorld(pointer)));
      return;
    }

    // 도형 도구 드래그 미리보기 — 시작점에서 현재 커서까지 사각형 갱신.
    if (
      (activeTool === 'rect' || activeTool === 'ellipse') &&
      shapeDragStartRef.current
    ) {
      const world = stageToWorld(pointer);
      const start = shapeDragStartRef.current;
      // Shift 누르면 정사각형/원 — 더 짧은 변에 맞춰 양쪽 동시 신장.
      let w = world.x - start.x;
      let h = world.y - start.y;
      if (isShiftDownRef.current) {
        const m = Math.min(Math.abs(w), Math.abs(h));
        w = m * Math.sign(w || 1);
        h = m * Math.sign(h || 1);
      }
      setShapeDraft({
        x: Math.min(start.x, start.x + w),
        y: Math.min(start.y, start.y + h),
        width: Math.abs(w),
        height: Math.abs(h),
      });
      return;
    }

    // 대지 도구 드래그 미리보기 — 시작점에서 현재 커서까지 사각형 갱신.
    if (activeTool === 'artboard' && artboardDragStartRef.current) {
      const world = stageToWorld(pointer);
      const start = artboardDragStartRef.current;
      setArtboardDraft({
        x: Math.min(start.x, world.x),
        y: Math.min(start.y, world.y),
        width: Math.abs(world.x - start.x),
        height: Math.abs(world.y - start.y),
      });
      return;
    }

    if (!marqueeStartRef.current) return;
    const world = stageToWorld(pointer);
    const start = marqueeStartRef.current;
    setMarquee({
      x: Math.min(start.x, world.x),
      y: Math.min(start.y, world.y),
      width: Math.abs(world.x - start.x),
      height: Math.abs(world.y - start.y),
    });
  }, [stageToWorld, activeTool, viewport.zoom, setLastAnchorHandleOut, penWorldToLocal]);

  const handleStageMouseUp = useCallback(() => {
    // 펜툴 드래그 종료 — anchor는 이미 mousedown에서 추가됐고, mousemove에서 핸들이 갱신됐다.
    // mouseup은 단지 "다음 click을 받을 준비" 상태로 돌아가는 트리거.
    if (activeTool === 'pen' && penIsDraggingRef.current) {
      penIsDraggingRef.current = false;
      penDragStartRef.current = null;
      return;
    }

    // 도형 도구 드래그 종료 — 충분한 크기면 새 part 생성, 아니면 무시.
    if (
      (activeTool === 'rect' || activeTool === 'ellipse') &&
      shapeDragStartRef.current
    ) {
      const draft = shapeDraft;
      const tool = activeTool;
      shapeDragStartRef.current = null;
      setShapeDraft(null);
      if (draft && draft.width >= 4 && draft.height >= 4) {
        const create = tool === 'rect' ? createRectPart : createEllipsePart;
        const newId = create(draft);
        // 생성 직후 select 도구로 자동 전환 — 일러스트레이터 컨벤션이 아닌 Figma 컨벤션이지만
        // 한 번 그리고 바로 이동/크기 조정으로 넘어가는 흐름이 자연스럽다.
        if (newId) setActiveTool('select');
      }
      return;
    }

    // 대지 도구 드래그 종료 — 충분한 크기면 새 대지 생성, 아니면 클릭 취급으로 종료.
    if (activeTool === 'artboard' && artboardDragStartRef.current) {
      const draft = artboardDraft;
      artboardDragStartRef.current = null;
      setArtboardDraft(null);
      if (draft && draft.width >= 4 && draft.height >= 4) {
        createArtboard(draft);
      }
      return;
    }

    if (!marqueeStartRef.current || !marquee) {
      marqueeStartRef.current = null;
      setMarquee(null);
      return;
    }
    const rect = marquee;
    marqueeStartRef.current = null;
    setMarquee(null);

    // 너무 작은 박스는 클릭 취급 — 선택 변경 없이 종료.
    if (rect.width < 2 && rect.height < 2) return;

    // 직접 선택(A) 도구 마퀴 — part 가 아니라 anchor 단위로 잡는다.
    // sketch 의 모든 part 를 순회하며, 각 anchor 의 world 좌표가 rect 안에 들어오면 hit.
    if (activeTool === 'direct-select') {
      const anchorHits: AnchorRef[] = [];
      if (sketch) {
        for (const part of sketch.parts) {
          if (part.locked) continue;
          const t = part.transform ?? DEFAULT_TRANSFORM;
          const rad = (t.rotation * Math.PI) / 180;
          const cs = Math.cos(rad);
          const sn = Math.sin(rad);
          for (const a of part.anchors) {
            const sx = a.x * t.scaleX;
            const sy = a.y * t.scaleY;
            const wx = sx * cs - sy * sn + t.x;
            const wy = sx * sn + sy * cs + t.y;
            if (
              wx >= rect.x &&
              wx <= rect.x + rect.width &&
              wy >= rect.y &&
              wy <= rect.y + rect.height
            ) {
              anchorHits.push({ partId: part.id, anchorId: a.id });
            }
          }
        }
      }
      if (anchorHits.length > 0) {
        if (marqueeShiftRef.current) addAnchorsToSelection(anchorHits);
        else selectAnchors(anchorHits);
      }
      return;
    }

    // 파트 노드의 world bounding box와 교차하는 것들을 선택.
    // 잠금된 파트는 제외 — 마퀴로도 선택되지 않도록. (Path 노드는 listening=false 라
    // 직접 클릭은 차단되지만, getClientRect 는 listening 과 무관하게 동작해서 마퀴에는 잡힌다.)
    const lockedSet = new Set(
      (sketch?.parts ?? []).filter((p) => p.locked === true).map((p) => p.id),
    );
    const hits: string[] = [];
    pathNodeMap.current.forEach((node, partId) => {
      if (lockedSet.has(partId)) return;
      // getClientRect를 stage 기준 좌표로 받기.
      const box = node.getClientRect({ relativeTo: layerRef.current ?? undefined });
      if (rectsIntersect(box, rect)) hits.push(partId);
    });
    if (hits.length > 0) selectMany([...new Set([...selectedPartIds, ...hits])]);
  }, [
    marquee,
    selectMany,
    selectedPartIds,
    sketch,
    activeTool,
    artboardDraft,
    createArtboard,
    shapeDraft,
    createRectPart,
    createEllipsePart,
    setActiveTool,
    selectAnchors,
    addAnchorsToSelection,
  ]);

  // ── Transformer 노드 갱신 ────────────────────────────────
  // selectedPartIds가 바뀔 때마다 Transformer.nodes를 재설정.
  // 직접 선택(A) 도구에선 변형 핸들을 숨겨 앵커 편집 UX를 어지럽히지 않는다.
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (activeTool !== 'select') {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const nodes: Konva.Node[] = [];
    const partsById = new Map(sketch?.parts.map((p) => [p.id, p]) ?? []);
    for (const id of selectedPartIds) {
      const part = partsById.get(id);
      // 숨김(visible=false) 또는 잠금(locked=true) 파트는 Transformer에 붙이지 않는다 —
      // 잠긴 파트가 핸들로 변형되거나 숨긴 파트의 핸들만 떠 있는 어색한 상태를 방지.
      if (part && (part.visible === false || part.locked === true)) continue;
      const node = pathNodeMap.current.get(id);
      if (node) nodes.push(node);
    }
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedPartIds, sketch?.parts, activeTool]);

  // ── 대지 Transformer 동기화 ───────────────────────────────
  // 대지는 'artboard' 도구에서만 transformer가 붙는다 — V(select) 도구에서는 파트만 다룬다.
  useEffect(() => {
    const tr = artboardTransformerRef.current;
    if (!tr) return;
    if (!selectedArtboardId || activeTool !== 'artboard') {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const node = artboardNodeMap.current.get(selectedArtboardId);
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedArtboardId, activeTool, artboards]);

  // ── 파트 변형 커밋 ───────────────────────────────────────
  // dragend / transformend에서 노드의 현재 transform을 store로 반영.
  const commitNodeTransform = useCallback(
    (partId: string, node: Konva.Node) => {
      updatePartTransform(partId, {
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
      });
    },
    [updatePartTransform],
  );

  // 그룹 드래그/변형 시 Konva.Transformer 가 부착된 모든 노드에 dragend/transformend 를
  // 순차 발생시킨다. 파트별로 updatePartTransform 을 호출하면 zundo 가 매번 새 스냅샷을
  // 쌓아 Ctrl+Z 시 한 파트씩 되돌아가는 문제가 난다. 첫 호출에서 부착된 모든 노드의 transform
  // 을 한 번의 set() 으로 일괄 커밋하고, 같은 드래그의 후속 dragend/transformend 는 스킵하여
  // 한 번의 그룹 이동 = 하나의 undo 가 되도록 보장한다.
  const partOpCommittedRef = useRef(false);
  const beginPartOp = useCallback(() => {
    partOpCommittedRef.current = false;
  }, []);
  const commitNodeTransformBatched = useCallback(
    (partId: string, node: Konva.Node) => {
      if (partOpCommittedRef.current) return;
      const tr = transformerRef.current;
      const attached = tr?.nodes() ?? [];
      if (attached.length > 1) {
        const updates: Array<{ id: string; transform: Transform }> = [];
        const nodeToId = new Map<Konva.Node, string>();
        pathNodeMap.current.forEach((n, id) => nodeToId.set(n, id));
        for (const n of attached) {
          const id = nodeToId.get(n as Konva.Path);
          if (!id) continue;
          updates.push({
            id,
            transform: {
              x: n.x(),
              y: n.y(),
              rotation: n.rotation(),
              scaleX: n.scaleX(),
              scaleY: n.scaleY(),
            },
          });
        }
        if (updates.length > 0) updatePartTransforms(updates);
      } else {
        commitNodeTransform(partId, node);
      }
      partOpCommittedRef.current = true;
    },
    [commitNodeTransform, updatePartTransforms],
  );

  // 드래그/변형 중 메인 Path 의 라이브 transform 을 선택 오버레이 노드에 즉시 복사한다.
  // (store transform 은 dragend/transformend 에서만 커밋되므로 그 전까지 오버레이가 뒤처진다.)
  const syncSelectionOverlay = useCallback(
    (partId: string, node: Konva.Node) => {
      const overlay = selectionOverlayNodeMap.current.get(partId);
      if (!overlay) return;
      // 리사이즈(Transformer) 중에는 노드 스케일이 커밋 전이라, 라이브 스케일로 strokeWidth 도
      // 다시 계산해 두께가 일정하게 유지되도록 한다.
      const liveScale = Math.max(Math.abs(node.scaleX() || 1), Math.abs(node.scaleY() || 1));
      overlay.setAttrs({
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
        strokeWidth: SELECTION_STROKE_WIDTH_PX / (viewport.zoom * liveScale),
      });
    },
    [viewport.zoom],
  );

  // ── anchor/handle 드래그 history 배치 헬퍼 ────────────────
  // dragStart에서 beginAnchorDrag → 첫 dragMove에서 markFirstDragMove → dragEnd에서 endAnchorDrag.
  // 이 시퀀스로 한 번의 드래그 전체가 단일 undo 스텝이 된다.
  const beginAnchorDrag = useCallback(() => {
    dragHistoryPendingRef.current = true;
  }, []);
  const markFirstDragMove = useCallback(() => {
    if (!dragHistoryPendingRef.current) return;
    // 직전 set()이 pre-drag 스냅샷을 past에 push한 직후라 이 시점에 멈춰야 한다.
    useTemporalStore.getState().pause();
    dragHistoryPendingRef.current = false;
  }, []);
  const endAnchorDrag = useCallback(() => {
    // dragEnd가 dragMove 없이 도달했으면(클릭만) 아무것도 안 하고 플래그 해제.
    dragHistoryPendingRef.current = false;
    useTemporalStore.getState().resume();
  }, []);

  // ── 키보드 단축키 (Delete / Cmd+D / Cmd+Z / Cmd+Shift+Z) ──
  const undo = useCallback(() => useTemporalStore.getState().undo(), []);
  const redo = useCallback(() => useTemporalStore.getState().redo(), []);

  // ── 보기(View) 줌 명령 ─────────────────────────────────────
  // 편집 가능한 스테이지 영역 크기(비교 모드면 우측 절반).
  const stageRegion = useCallback(() => {
    const w = compareMode ? containerSize.width / 2 : containerSize.width;
    return { w, h: containerSize.height };
  }, [compareMode, containerSize.width, containerSize.height]);

  // world 사각형이 패딩 안에 들어오도록 viewport(중앙 정렬)를 설정.
  const fitViewportToRect = useCallback(
    (target: { x: number; y: number; width: number; height: number }) => {
      const { w: stageWidth, h: stageHeight } = stageRegion();
      if (stageWidth <= 0 || stageHeight <= 0) return;
      if (target.width <= 0 || target.height <= 0) return;
      const availableW = Math.max(1, stageWidth - FIT_PADDING * 2);
      const availableH = Math.max(1, stageHeight - FIT_PADDING * 2);
      const fitZoom = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, Math.min(availableW / target.width, availableH / target.height)),
      );
      const x = (stageWidth - target.width * fitZoom) / 2 - target.x * fitZoom;
      const y = (stageHeight - target.height * fitZoom) / 2 - target.y * fitZoom;
      setViewport({ x, y, zoom: fitZoom });
    },
    [stageRegion, setViewport],
  );

  // 화면 맞춤 대상 선택 — 선택 대지 > 현재 보고 있는 대지 > sketch.canvas.
  const pickFitTarget = useCallback((): { x: number; y: number; width: number; height: number } | null => {
    const { w: stageWidth, h: stageHeight } = stageRegion();
    const abList = artboards ?? [];
    if (selectedArtboardId) {
      const ab = abList.find((a) => a.id === selectedArtboardId);
      if (ab) return { x: ab.x, y: ab.y, width: ab.width, height: ab.height };
    }
    if (abList.length > 0) {
      const worldCenterX = (stageWidth / 2 - viewport.x) / viewport.zoom;
      const worldCenterY = (stageHeight / 2 - viewport.y) / viewport.zoom;
      const containing = abList.find(
        (ab) =>
          worldCenterX >= ab.x &&
          worldCenterX <= ab.x + ab.width &&
          worldCenterY >= ab.y &&
          worldCenterY <= ab.y + ab.height,
      );
      let pick = containing;
      if (!pick) {
        let bestDist = Infinity;
        for (const ab of abList) {
          const cx = ab.x + ab.width / 2;
          const cy = ab.y + ab.height / 2;
          const d = (cx - worldCenterX) ** 2 + (cy - worldCenterY) ** 2;
          if (d < bestDist) {
            bestDist = d;
            pick = ab;
          }
        }
      }
      if (pick) return { x: pick.x, y: pick.y, width: pick.width, height: pick.height };
    }
    if (sketch) return { x: 0, y: 0, width: sketch.canvas.width, height: sketch.canvas.height };
    return null;
  }, [stageRegion, artboards, selectedArtboardId, viewport.x, viewport.y, viewport.zoom, sketch]);

  const zoomToFit = useCallback(() => {
    const t = pickFitTarget();
    if (t) fitViewportToRect(t);
  }, [pickFitTarget, fitViewportToRect]);

  // 선택 영역 확대 — 선택 파트들의 world bbox 에 맞춤. 선택이 없으면 화면 맞춤으로 폴백.
  const zoomToSelection = useCallback(() => {
    const layer = layerRef.current;
    if (!layer || selectedPartIds.length === 0) {
      zoomToFit();
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of selectedPartIds) {
      const node = pathNodeMap.current.get(id);
      if (!node) continue;
      // layer 기준 getClientRect = world 좌표(스테이지 scale/translate 이전).
      const b = node.getClientRect({ relativeTo: layer });
      if (b.width === 0 && b.height === 0) continue;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    if (!Number.isFinite(minX)) {
      zoomToFit();
      return;
    }
    fitViewportToRect({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
  }, [selectedPartIds, zoomToFit, fitViewportToRect]);

  // 스테이지 중앙(화면 중심)을 고정점으로 zoom 을 절대값으로 설정.
  const setZoomAtCenter = useCallback(
    (nextZoomRaw: number) => {
      const { w: stageWidth, h: stageHeight } = stageRegion();
      if (stageWidth <= 0 || stageHeight <= 0) return;
      const cx = stageWidth / 2;
      const cy = stageHeight / 2;
      const oldZoom = viewport.zoom;
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoomRaw));
      if (nextZoom === oldZoom) return;
      const worldX = (cx - viewport.x) / oldZoom;
      const worldY = (cy - viewport.y) / oldZoom;
      setViewport({ x: cx - worldX * nextZoom, y: cy - worldY * nextZoom, zoom: nextZoom });
    },
    [stageRegion, viewport.x, viewport.y, viewport.zoom, setViewport],
  );

  const ZOOM_STEP = 1.25;
  const zoomIn = useCallback(() => setZoomAtCenter(viewport.zoom * ZOOM_STEP), [setZoomAtCenter, viewport.zoom]);
  const zoomOut = useCallback(() => setZoomAtCenter(viewport.zoom / ZOOM_STEP), [setZoomAtCenter, viewport.zoom]);
  const zoomTo100 = useCallback(() => setZoomAtCenter(1), [setZoomAtCenter]);

  // 보기 메뉴(좌측 패널)가 큐에 넣은 명령을 소비 — 실행 후 즉시 비운다.
  useEffect(() => {
    if (!pendingViewCommand) return;
    switch (pendingViewCommand) {
      case 'zoom-in': zoomIn(); break;
      case 'zoom-out': zoomOut(); break;
      case 'zoom-100': zoomTo100(); break;
      case 'zoom-fit': zoomToFit(); break;
      case 'zoom-selection': zoomToSelection(); break;
    }
    clearViewCommand();
  }, [pendingViewCommand, zoomIn, zoomOut, zoomTo100, zoomToFit, zoomToSelection, clearViewCommand]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;

      // Undo / Redo
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      // ── 보기(View) 단축키 ──────────────────────────────────
      // 눈금자 — Shift+R. (Ctrl+R 은 브라우저 새로고침과 충돌하므로 Figma 식 Shift+R 채택.)
      if (!mod && e.shiftKey && e.code === 'KeyR') {
        e.preventDefault();
        toggleRuler();
        return;
      }
      // UI 표시/숨기기 — Ctrl+\, UI 최소화 — Ctrl+Shift+\. (Shift+\ 는 '|' 이므로 e.code 로 매칭.)
      if (mod && e.code === 'Backslash') {
        e.preventDefault();
        if (e.shiftKey) toggleUIMinimized();
        else toggleHideUI();
        return;
      }
      // 확대 — Ctrl+= / Ctrl++ (numpad 포함).
      if (mod && (e.code === 'Equal' || e.code === 'NumpadAdd')) {
        e.preventDefault();
        zoomIn();
        return;
      }
      // 축소 — Ctrl+- (numpad 포함).
      if (mod && (e.code === 'Minus' || e.code === 'NumpadSubtract')) {
        e.preventDefault();
        zoomOut();
        return;
      }
      // 100%로 확대 — Shift+0. (Ctrl+0 은 화면 맞춤에 쓰므로 분리.)
      if (!mod && e.shiftKey && e.code === 'Digit0') {
        e.preventDefault();
        zoomTo100();
        return;
      }
      // 선택 영역 확대 — Shift+2.
      if (!mod && e.shiftKey && e.code === 'Digit2') {
        e.preventDefault();
        zoomToSelection();
        return;
      }
      // 화면에 맞게 축소/확대 — Cmd/Ctrl+0. 일러스트레이터 ⌘0 동작.
      // 우선순위: 선택 대지 > 현재 보고 있는 대지 > sketch.canvas (zoomToFit 내부 로직).
      // ')'는 Shift+0의 일부 키보드 레이아웃 fallback. e.code='Digit0' 우선 매칭.
      if (mod && (e.code === 'Digit0' || e.key === '0' || e.key === ')')) {
        e.preventDefault();
        zoomToFit();
        return;
      }

      // Duplicate
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (selectedPartIds.length > 0) duplicateParts(selectedPartIds);
        return;
      }

      // 그룹 / 그룹 해제 — Cmd/Ctrl+G, Cmd/Ctrl+Shift+G.
      if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) {
          if (selectedPartIds.length > 0) ungroupParts(selectedPartIds);
        } else {
          if (selectedPartIds.length >= 2) groupParts(selectedPartIds);
        }
        return;
      }

      // Copy / Paste — Cmd/Ctrl+C, Cmd/Ctrl+V. 시스템 클립보드는 건드리지 않고 내부 store에 저장.
      if (mod && e.key.toLowerCase() === 'c') {
        if (selectedPartIds.length === 0) return;
        e.preventDefault();
        copyParts(selectedPartIds);
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteParts();
        return;
      }

      // 표시/숨기기 — Cmd/Ctrl+Shift+H. 좌우 반전 Shift+H 보다 먼저 검사해야 mod+Shift 조합이 가로채인다.
      if (mod && e.shiftKey && e.key.toLowerCase() === 'h') {
        if (selectedPartIds.length === 0) return;
        e.preventDefault();
        toggleVisibility(selectedPartIds);
        return;
      }
      // 잠금/잠금 해제 — Cmd/Ctrl+Shift+L.
      if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
        if (selectedPartIds.length === 0) return;
        e.preventDefault();
        toggleLock(selectedPartIds);
        return;
      }

      // 좌우/상하 반전 — Shift+H, Shift+V (modifier 없이).
      if (!mod && e.shiftKey && e.key.toLowerCase() === 'h') {
        if (activeTool !== 'select') return;
        if (selectedPartIds.length === 0) return;
        e.preventDefault();
        flipPartsHorizontal(selectedPartIds);
        return;
      }
      if (!mod && e.shiftKey && e.key.toLowerCase() === 'v') {
        if (activeTool !== 'select') return;
        if (selectedPartIds.length === 0) return;
        e.preventDefault();
        flipPartsVertical(selectedPartIds);
        return;
      }

      // 정렬 순서 — `]` (맨 앞), `[` (맨 뒤). modifier 없을 때만.
      if (!mod && (e.key === ']' || e.key === '[')) {
        if (activeTool !== 'select') return;
        if (selectedPartIds.length === 0) return;
        e.preventDefault();
        if (e.key === ']') bringToFront(selectedPartIds);
        else sendToBack(selectedPartIds);
        return;
      }

      // 화살표 nudge — 1px (Shift 시 10px). select 도구에서만 의미. direct-select는
      // anchor 편집이 우선이라 part-level nudge가 혼란스러우므로 비활성.
      if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        if (mod) return;
        if (activeTool !== 'select') return;
        if (selectedPartIds.length === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        else if (e.key === 'ArrowRight') dx = step;
        else if (e.key === 'ArrowUp') dy = -step;
        else if (e.key === 'ArrowDown') dy = step;
        nudgeParts(selectedPartIds, dx, dy);
        return;
      }

      // 떨어진 두 endpoint 잇기 — Cmd/Ctrl+J. 일러스트레이터 Object > Path > Join.
      // 같은 서브패스의 양 끝을 선택했으면 닫고, 다른 서브패스/다른 part 면 두 path 를 잇는다.
      // anchor 선택이 우선 — 직접선택 도구에서 두 endpoint 를 명시적으로 잡았다면 그대로 잇고,
      // 그 외에 select 도구에서 두 파트만 잡혀 있으면 가까운 endpoint 한 쌍을 자동으로 골라 잇는다.
      if (mod && e.key.toLowerCase() === 'j') {
        if (selectedAnchors.length === 2) {
          e.preventDefault();
          joinAnchors(selectedAnchors);
          return;
        }
        if (selectedPartIds.length === 2 && sketch) {
          const a = sketch.parts.find((p) => p.id === selectedPartIds[0]);
          const b = sketch.parts.find((p) => p.id === selectedPartIds[1]);
          if (a && b && hasOpenEndpoint(a) && hasOpenEndpoint(b)) {
            const pair = pickClosestOpenEndpointPair(a, b);
            if (pair) {
              e.preventDefault();
              joinAnchors(pair);
            }
          }
        }
        return;
      }

      // Pathfinder — Cmd/Ctrl+Shift+U: Unite(합치기), Cmd/Ctrl+Alt+Shift+U: Divide(분할).
      // 일러스트레이터에 기본 단축키는 없지만 'U'(니티) 가 가장 외우기 쉬워 합치기에 할당.
      // 2개 이상의 파트가 선택돼 있어야만 의미.
      if (mod && e.shiftKey && e.key.toLowerCase() === 'u') {
        if (selectedPartIds.length >= 2) {
          e.preventDefault();
          if (e.altKey) dividePaths(selectedPartIds);
          else unitePaths(selectedPartIds);
        }
        return;
      }

      // Delete / Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // 그라디언트 편집 중(핸들 바 표시)이고 선택된 stop 이 있으면 그 stop 만 삭제 — part 는 유지.
        // stop 은 최소 2개를 유지해야 그라디언트가 성립하므로 2개 이하일 땐 무시.
        if (isGradientPanelOpen && selectedPartIds.length === 1 && sketch) {
          const gp = sketch.parts.find((p) => p.id === selectedPartIds[0]);
          const gf = gp?.fill;
          if (gf && typeof gf !== 'string' && (gf.kind === 'linear' || gf.kind === 'radial') && gf.stops.length > 2) {
            const idx = selectedStopIndex;
            if (idx >= 0 && idx < gf.stops.length) {
              e.preventDefault();
              const stops = gf.stops.filter((_, k) => k !== idx).map((s) => ({ ...s }));
              updatePartStyle(gp!.id, { fill: { ...gf, stops } });
              // 삭제 후 인덱스가 범위를 벗어나지 않도록 클램프.
              setSelectedStopIndex(Math.min(idx, stops.length - 1));
              return;
            }
          }
        }
        // 직접 선택 + 다중 anchor 선택 상태면 anchor 들만 삭제. part 자체는 비어버린 경우만 제거.
        if (activeTool === 'direct-select' && selectedAnchors.length > 0) {
          e.preventDefault();
          deleteAnchors(selectedAnchors);
          return;
        }
        // 대지가 선택돼 있으면 대지 삭제 우선.
        if (selectedArtboardId) {
          e.preventDefault();
          deleteArtboard(selectedArtboardId);
          return;
        }
        if (selectedPartIds.length === 0) return;
        e.preventDefault();
        deleteParts(selectedPartIds);
        return;
      }

      // Enter — 펜 드래프트가 있으면 닫지 않고 종료(open path 유지).
      if (e.key === 'Enter' && activeTool === 'pen' && penDraftPartIdRef.current) {
        e.preventDefault();
        penDraftPartIdRef.current = null;
        penDragStartRef.current = null;
        penIsDraggingRef.current = false;
        setPenPreviewCursor(null);
        return;
      }

      // Escape — 펜 드래프트 종료 → 일반 선택 해제.
      if (e.key === 'Escape') {
        if (activeTool === 'pen' && penDraftPartIdRef.current) {
          penDraftPartIdRef.current = null;
          penDragStartRef.current = null;
          penIsDraggingRef.current = false;
          setPenPreviewCursor(null);
          return;
        }
        // 대지 드래그 중이면 취소만.
        if (activeTool === 'artboard' && artboardDragStartRef.current) {
          artboardDragStartRef.current = null;
          setArtboardDraft(null);
          return;
        }
        // 도형 드래그 중이면 취소.
        if (
          (activeTool === 'rect' || activeTool === 'ellipse') &&
          shapeDragStartRef.current
        ) {
          shapeDragStartRef.current = null;
          setShapeDraft(null);
          return;
        }
        clearSelection();
        return;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    selectedPartIds,
    selectedAnchorId,
    selectedAnchors,
    selectedArtboardId,
    activeTool,
    duplicateParts,
    deleteParts,
    deleteAnchor,
    deleteAnchors,
    deleteArtboard,
    joinAnchors,
    clearSelection,
    undo,
    redo,
    groupParts,
    ungroupParts,
    copyParts,
    pasteParts,
    nudgeParts,
    flipPartsHorizontal,
    flipPartsVertical,
    bringToFront,
    sendToBack,
    toggleVisibility,
    toggleLock,
    unitePaths,
    dividePaths,
    sketch,
    artboards,
    containerSize,
    compareMode,
    viewport,
    setViewport,
    isGradientPanelOpen,
    selectedStopIndex,
    setSelectedStopIndex,
    updatePartStyle,
    toggleRuler,
    toggleHideUI,
    toggleUIMinimized,
    zoomIn,
    zoomOut,
    zoomTo100,
    zoomToFit,
    zoomToSelection,
  ]);

  // ── 파생 값 ──────────────────────────────────────────────
  const canvasSize = sketch ? getCanvasSize(sketch) : { width: 800, height: 1000 };
  const sortedParts = useMemo<Part[]>(() => {
    if (!sketch) return [];
    return [...sketch.parts].sort((a, b) => a.z_index - b.z_index);
  }, [sketch]);
  const selectedSet = useMemo(() => new Set(selectedPartIds), [selectedPartIds]);
  const hasRawSvg = !!(sketch?.raw_svg && sketch.parts.length === 0);

  // 그라디언트 핸들 정규화 — 선택 part 가 바뀔 때 한 번, fill 의 끝점이 part bbox 의
  // margin 밖이면 bbox 의 중앙 세로축으로 reset. .ai/PDF 가 만든 그라디언트 axis 가
  // 화면 밖이거나 path 모양과 어긋난 경우 핸들이 패스 위로 오게 한다.
  // deps 에 partId 만 있어서 사용자가 끝점을 직접 드래그한 위치는 보존됨.
  const normalizeTargetPartId =
    selectedPartIds.length === 1 ? selectedPartIds[0] : null;
  useEffect(() => {
    if (!normalizeTargetPartId) return;
    const part = useEditorStore.getState().sketch?.parts.find(
      (p) => p.id === normalizeTargetPartId,
    );
    if (!part) return;
    const f = part.fill;
    if (!f || typeof f === 'string') return;
    if (f.kind !== 'linear' && f.kind !== 'radial') return;
    const b = part.bounding_box;
    if (b.width <= 0 || b.height <= 0) return;
    // 끝점이 bbox 의 1.5배 margin 밖에 있거나, 둘 사이 거리가 짧은변의 5% 미만이면 normalize.
    const margin = Math.max(b.width, b.height) * 0.5;
    const minX = b.x - margin;
    const minY = b.y - margin;
    const maxX = b.x + b.width + margin;
    const maxY = b.y + b.height + margin;
    const p0 = f.kind === 'linear' ? { x: f.x1, y: f.y1 } : { x: f.fx, y: f.fy };
    const p1 = f.kind === 'linear'
      ? { x: f.x2, y: f.y2 }
      : { x: f.cx + f.r1, y: f.cy };
    const outside =
      p0.x < minX || p0.x > maxX || p0.y < minY || p0.y > maxY ||
      p1.x < minX || p1.x > maxX || p1.y < minY || p1.y > maxY;
    const dist = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2);
    const tooShort = dist < Math.min(b.width, b.height) * 0.05;
    if (!outside && !tooShort) return;
    // bbox 중앙 세로축으로 reset. stops 는 보존.
    const cx = b.x + b.width / 2;
    if (f.kind === 'linear') {
      updatePartStyle(part.id, {
        fill: { ...f, x1: cx, y1: b.y, x2: cx, y2: b.y + b.height },
      });
    } else {
      const ncx = b.x + b.width / 2;
      const ncy = b.y + b.height / 2;
      const r = Math.min(b.width, b.height) / 2;
      updatePartStyle(part.id, {
        fill: { ...f, fx: ncx, fy: ncy, cx: ncx, cy: ncy, r0: 0, r1: r },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizeTargetPartId]);

  // 단일 선택일 때만 anchor/handle 오버레이를 띄운다 — 다중 선택은 Transformer만으로 충분하고
  // 여러 파트의 베지어 구조를 한꺼번에 보이면 시각적 혼잡으로 가독성이 떨어진다.
  const selectedPart = useMemo<Part | null>(() => {
    if (!sketch || selectedPartIds.length !== 1) return null;
    return sketch.parts.find((p) => p.id === selectedPartIds[0]) ?? null;
  }, [sketch, selectedPartIds]);

  // 매 렌더 후 노드 매핑에서 사라진 id 제거.
  useEffect(() => {
    if (!sketch) return;
    const liveIds = new Set(sketch.parts.map((p) => p.id));
    pathNodeMap.current.forEach((_, key) => {
      if (!liveIds.has(key)) pathNodeMap.current.delete(key);
    });
  }, [sketch]);

  // ── 렌더링 ───────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-neutral-100"
      // 우클릭 라우팅 — 파트 위는 Konva Path.onContextMenu(handlePartContextMenu) 가 먼저 처리.
      // 그 외(대지 배경 / 빈 영역) 는 여기 wrapper 핸들러가 좌표를 보고 분기해서 메뉴를 띄운다.
      onContextMenu={handleWrapperContextMenu}
    >
      {/* 눈금자 — 보기 > 눈금자(Shift+R). 편집 스테이지 영역(비교 모드면 우측 절반) 위에
          world 좌표 눈금을 그린다. pointer-events 없음. floating 패널(z-30)보다 아래. */}
      {showRuler && phase.tag === 'canvas' && (
        <div
          className="absolute inset-y-0 right-0 z-20 pointer-events-none"
          style={{ width: compareMode ? containerSize.width / 2 : containerSize.width }}
        >
          <CanvasRuler
            width={compareMode ? containerSize.width / 2 : containerSize.width}
            height={containerSize.height}
            viewport={viewport}
          />
        </div>
      )}

      {/* phase 무관 floating 패널 — Replicate 가 만든 원본 PNG 를 새 탭에서 확인.
          webhook 이 output_image_url 을 채우는 즉시 노출되어 벡터화 진행 중에도 결과 점검 가능.
          'canvas phase + raw_svg' 일 때는 옆에 '원본 비교' 버튼도 함께 보인다. */}
      {(replicateImageUrl || (phase.tag === 'canvas' && sketch?.raw_svg)) && (
        <div className="absolute top-2 right-2 z-30 flex items-center gap-2">
          {replicateImageUrl && (
            <a
              href={replicateImageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-neutral-300 bg-white/90 px-3 py-1 text-xs text-neutral-700 shadow-sm hover:bg-white"
            >
              Replicate 이미지
            </a>
          )}
          {phase.tag === 'canvas' && sketch?.raw_svg && (
            <button
              type="button"
              onClick={() => setCompareMode((v) => !v)}
              className="rounded-md border border-neutral-300 bg-white/90 px-3 py-1 text-xs text-neutral-700 shadow-sm hover:bg-white"
            >
              {compareMode ? '비교 닫기' : '원본 비교'}
            </button>
          )}
        </div>
      )}

      {phase.tag === 'loading' && (
        // 초기 프로젝트 fetch 중 — placeholder 대지가 아직 없는 시점에만 도달.
        // (이미지 업로드 / 잡 재개는 placeholder + canvas 단계로 바로 진입하므로 이 블록을 거치지 않는다.)
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-white">
          <div
            className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-300 border-t-neutral-700"
            aria-hidden="true"
          />
          <p className="text-sm text-neutral-600">불러오는 중...</p>
        </div>
      )}

      {phase.tag === 'error' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-neutral-100/90 p-6">
          <p className="text-sm font-medium text-red-600">{phase.message}</p>
          <button
            onClick={() => {
              setPhase({ tag: 'upload' });
              // 빈(upload) 상태로 돌아가면 첫 진입과 동일하게 생성 툴 선택 + image input 펼침.
              setImageInputOpen(true);
            }}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 transition-colors"
          >
            다시 시도
          </button>
        </div>
      )}

      {phase.tag === 'upload' && <UploadPhase />}

      {/* Sparkle(AI 생성) 버튼이 열고 닫는 image input — phase 와 무관하게 항상 마운트.
          가시성은 store 의 imageInputOpen 으로만 제어. hideUI(완전 숨김) 시엔 같이 사라진다. */}
      {!hideUI && <ImageInputPanel onFileChange={handleFileChange} />}

      {phase.tag === 'canvas' && (
        <>
          <div
            className={`absolute inset-0 z-0 ${
              isPanning ? 'cursor-grab' : 'cursor-default'
            }`}
            aria-hidden="true"
          />

          {/* 우상단 floating 패널 — '원본 비교' 토글은 canvas phase 안에서만 의미 있어 여기 둔다.
              'Replicate 이미지' 버튼은 phase 와 무관해서 아래 통합 패널로 따로 뺐다. */}

          {/* 좌측 — 편집 불가 원본 SVG (Arrow 출력 그대로).
              data URL <img>로 띄워 SVG 자체의 viewBox·자체 배경을 그대로 보존. */}
          {compareMode && sketch?.raw_svg && (
            <div
              className="absolute inset-y-0 left-0 z-10 border-r border-neutral-300 bg-white overflow-hidden"
              style={{ width: containerSize.width / 2 }}
            >
              <div
                className="absolute top-2 left-2 rounded bg-neutral-900/80 px-2 py-0.5 text-[10px] font-medium text-white z-10"
                aria-hidden="true"
              >
                원본 (Arrow)
              </div>
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <img
                  src={svgToDataUrl(sketch.raw_svg)}
                  alt="Arrow 원본 SVG"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            </div>
          )}

          {/* 우측 — 편집 가능한 Konva Stage. */}
          <div
            className="absolute inset-y-0 right-0"
            style={{ width: compareMode ? containerSize.width / 2 : containerSize.width }}
          >
            <Stage
              ref={stageRef}
              width={compareMode ? containerSize.width / 2 : containerSize.width}
              height={containerSize.height}
              draggable={isPanning}
              scaleX={viewport.zoom}
              scaleY={viewport.zoom}
              x={viewport.x}
              y={viewport.y}
              onWheel={handleWheel}
              onDragStart={handleStageDragStart}
              onDragEnd={handleStageDragEnd}
              onMouseDown={handleStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={handleStageMouseUp}
              onMouseLeave={() => {
                // 커서가 stage 밖으로 나가면 rubber-band가 캔버스 밖에서 어색하게 늘어지지 않도록 감춘다.
                if (activeTool === 'pen') setPenPreviewCursor(null);
              }}
            >
            <Layer ref={layerRef}>
              {/* 도식화 캔버스 백지 배경 — Arrow 원본 SVG는 보통 흰 배경 가정으로 그려지지만,
                  parts로 분해되면 명시적인 배경 rect가 없을 수 있어 그레이 컨테이너가 비쳐 보인다.
                  렌더 분기와 무관하게 캔버스 영역을 흰색으로 깔아 그 인상을 복원. */}
              <Rect
                x={0}
                y={0}
                width={canvasSize.width}
                height={canvasSize.height}
                fill="#ffffff"
                listening={false}
              />

              {/* 사용자가 추가한 대지(Artboard)들 — 파트 아래에 깔린다.
                  Rect는 이동/리사이즈 가능. 라벨은 별도 Text로 위에 떠 있다.
                  select/artboard 도구일 때 draggable, 선택 시 별도 Transformer가 붙어 리사이즈. */}
              {artboards?.map((ab) => {
                const isSelected = selectedArtboardId === ab.id;
                // 라벨 폰트는 화면 픽셀 12px 기준 — 줌과 무관하게 일정한 크기로.
                const labelFontSize = 12 / viewport.zoom;
                const labelOffsetY = 4 / viewport.zoom;
                // 대지는 'artboard' 도구에서만 인터랙티브 — V(select) 도구는 파트 전용.
                // V 모드에서는 listening=false로 hit 자체를 막아 마퀴/패닝이 대지 위에서도 동작하게 한다.
                const interactive = activeTool === 'artboard';
                return (
                  <Group key={ab.id}>
                    <Rect
                      ref={(node) => {
                        if (node) artboardNodeMap.current.set(ab.id, node);
                        else artboardNodeMap.current.delete(ab.id);
                      }}
                      x={ab.x}
                      y={ab.y}
                      width={ab.width}
                      height={ab.height}
                      fill="#ffffff"
                      strokeEnabled={false}
                      listening={interactive}
                      draggable={interactive && !isPanning}
                      onMouseDown={(e) => {
                        if (isPanningRef.current) return;
                        if (!interactive) return;
                        // 대지 도구의 stage 드래그-생성과 select 도구의 마퀴를 모두 차단하고 대지 선택.
                        e.cancelBubble = true;
                        selectArtboard(ab.id);
                      }}
                      onDragStart={(e) => {
                        e.cancelBubble = true;
                        selectArtboard(ab.id);
                        dragStartAbsRef.current.set(ab.id, e.target.absolutePosition());
                        snapTargetsRef.current = buildSnapTargets(new Set(), ab.id);
                      }}
                      dragBoundFunc={(pos) => {
                        // 대지의 local bbox는 (0, 0, ab.width, ab.height) — Rect.x/y가 곧 transform.x/y.
                        const snapped = snapDragWithGuides(
                          pos,
                          { x: ab.x, y: ab.y },
                          { x: 0, y: 0, width: ab.width, height: ab.height },
                          { sx: 1, sy: 1 },
                        );
                        applyGuides(snapped.guides);
                        return snapDragToAxis(ab.id, snapped.posAbs);
                      }}
                      onDragEnd={(e) => {
                        updateArtboard(ab.id, { x: e.target.x(), y: e.target.y() });
                        dragStartAbsRef.current.delete(ab.id);
                        applyGuides({ vertical: [], horizontal: [] });
                      }}
                      onTransformEnd={(e) => {
                        const node = e.target as Konva.Rect;
                        const newWidth = Math.max(1, node.width() * node.scaleX());
                        const newHeight = Math.max(1, node.height() * node.scaleY());
                        updateArtboard(ab.id, {
                          x: node.x(),
                          y: node.y(),
                          width: newWidth,
                          height: newHeight,
                        });
                        node.scaleX(1);
                        node.scaleY(1);
                      }}
                    />
                    <Text
                      x={ab.x}
                      y={ab.y - labelFontSize - labelOffsetY}
                      text={ab.name}
                      fontSize={labelFontSize}
                      fontFamily="Inter, system-ui, sans-serif"
                      fill={isSelected ? SELECTION_STROKE : '#4b5563'}
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                  </Group>
                );
              })}

              {/* 대지 도구 드래그 미리보기 — 파선 박스. */}
              {artboardDraft && (
                <Rect
                  x={artboardDraft.x}
                  y={artboardDraft.y}
                  width={artboardDraft.width}
                  height={artboardDraft.height}
                  fill={SELECTION_FILL}
                  stroke={SELECTION_STROKE}
                  strokeWidth={1 / viewport.zoom}
                  dash={[4 / viewport.zoom, 3 / viewport.zoom]}
                  listening={false}
                />
              )}

              {/* 도형 도구 드래그 미리보기 — rect는 사각, ellipse는 같은 박스 안 타원. */}
              {shapeDraft && activeTool === 'rect' && (
                <Rect
                  x={shapeDraft.x}
                  y={shapeDraft.y}
                  width={shapeDraft.width}
                  height={shapeDraft.height}
                  stroke={SELECTION_STROKE}
                  strokeWidth={1 / viewport.zoom}
                  dash={[4 / viewport.zoom, 3 / viewport.zoom]}
                  listening={false}
                />
              )}
              {shapeDraft && activeTool === 'ellipse' && (
                <Circle
                  x={shapeDraft.x + shapeDraft.width / 2}
                  y={shapeDraft.y + shapeDraft.height / 2}
                  radius={Math.min(shapeDraft.width, shapeDraft.height) / 2}
                  stroke={SELECTION_STROKE}
                  strokeWidth={1 / viewport.zoom}
                  dash={[4 / viewport.zoom, 3 / viewport.zoom]}
                  scaleX={shapeDraft.width === 0 ? 1 : shapeDraft.width / Math.min(shapeDraft.width, shapeDraft.height)}
                  scaleY={shapeDraft.height === 0 ? 1 : shapeDraft.height / Math.min(shapeDraft.width, shapeDraft.height)}
                  listening={false}
                />
              )}

              {hasRawSvg && konvaImage && (
                <KonvaImage
                  image={konvaImage}
                  x={0}
                  y={0}
                  width={canvasSize.width}
                  height={canvasSize.height}
                  listening={false}
                />
              )}

              {!hasRawSvg &&
                sortedParts.map((part) => {
                  const transform = part.transform ?? DEFAULT_TRANSFORM;
                  const isSelected = selectedSet.has(part.id);
                  const isHovered = !isSelected && hoveredPartIds.has(part.id);
                  // 한 파트가 여러 svg_paths를 가질 수 있음 — 첫 path만 transformable 노드로,
                  // 나머지는 같은 transform 아래에 정렬되어야 하지만 Phase 1에선 단일 path 가정.
                  const pathData = part.svg_paths.join(' ');

                  // SVG의 fill/stroke="none"을 Konva에 그대로 넘기면 canvas의 fillStyle이
                  // invalid color로 떨어져 기본 검정으로 채워진다. undefined로 바꿔야 Konva가
                  // fill/stroke 자체를 건너뛴다. 그라디언트/패턴 fill 은 별도 props 로 넘어간다.
                  const fillKonva = fillToKonvaProps(part.fill);
                  // 브러쉬가 적용된 파트는 spine 스트로크를 숨기고 BrushLayer 타일만 보여준다.
                  // 단, 선택/호버 시엔 편집 대상 spine 을 선택색으로 표시한다.
                  const hasBrush = part.brush !== undefined;
                  const showSelection = isSelected || isHovered;
                  // 메인 Path 의 stroke.
                  // - 브러쉬 파트: spine 이 보이지 않으므로 선택 시엔 spine 을 파란 선으로 띄움(기존 동작).
                  // - 비-브러쉬 파트: 항상 원본 stroke 를 그대로 유지하고, 선택 표시는 메인 Path 위에
                  //   그려지는 파란 중앙선 오버레이가 담당한다(아래 참고).
                  const strokeProp = hasBrush
                    ? (showSelection ? SELECTION_STROKE : undefined)
                    : (part.stroke && part.stroke !== 'none' ? part.stroke : undefined);

                  // 선택 표시 두께 — 파트의 stroke_width 와 무관하게 항상 같은 화면 픽셀 두께.
                  // (브러쉬 spine 표시용. /viewport.zoom 으로 Stage 줌을 보정.)
                  const selectionWidthWorld = SELECTION_STROKE_WIDTH_PX / viewport.zoom;
                  // 선택 오버레이는 파트의 transform(scaleX/scaleY) 안에서 그려지므로, 파트를
                  // 확대하면 stroke 도 함께 커진다. Stage 줌(viewport.zoom)뿐 아니라 파트 스케일까지
                  // 나눠 항상 일정한 화면 픽셀 두께가 되도록 보정한다.
                  const partScale = Math.max(
                    Math.abs(transform.scaleX || 1),
                    Math.abs(transform.scaleY || 1),
                  );
                  const overlayStrokeWidth = selectionWidthWorld / partScale;

                  return (
                    <Fragment key={part.id}>
                    <Path
                      ref={(node) => {
                        if (node) pathNodeMap.current.set(part.id, node);
                        else pathNodeMap.current.delete(part.id);
                      }}
                      data={pathData}
                      // fill="none" 파트는 Konva가 절대 채우지 않도록 명시. open path도 Konva.Path는
                      // fill이 truthy일 때 implicit-close 채움을 시도하므로 fillEnabled까지 끊는다.
                      // 그라디언트 fill 은 fillKonva 가 fillLinearGradient*/Radial* props 로 풀어준다.
                      {...fillKonva}
                      stroke={strokeProp}
                      strokeEnabled={strokeProp !== undefined}
                      // 브러쉬 파트만 선택 시 1.5px 고정 두께(spine 표시). 비-브러쉬는 원본 두께 유지.
                      strokeWidth={
                        hasBrush && showSelection ? selectionWidthWorld : part.stroke_width
                      }
                      // 브러쉬 파트는 스트로크가 안 보여도 spine 을 클릭/드래그로 잡을 수 있게 hit 영역 확보.
                      hitStrokeWidth={hasBrush ? 12 : undefined}
                      dash={part.stroke_dasharray}
                      lineCap={part.stroke_linecap}
                      lineJoin={part.stroke_linejoin}
                      x={transform.x}
                      y={transform.y}
                      rotation={transform.rotation}
                      scaleX={transform.scaleX}
                      scaleY={transform.scaleY}
                      visible={part.visible !== false}
                      // listening=false면 hit/이벤트가 나가지 않는다. 잠금 시 드래그/선택/우클릭 모두 차단.
                      listening={part.locked !== true}
                      draggable={activeTool === 'select' && !isPanning && part.locked !== true}
                      onClick={(e) => handlePartClick(e, part.id)}
                      onTap={(e) => handlePartClick(e, part.id)}
                      onContextMenu={(e) => handlePartContextMenu(e, part.id)}
                      onMouseEnter={() => {
                        // 스포이드도 선택 툴처럼 hover 파란 표시선을 띄운다 — 어느 패스를
                        // 찍을지 미리 가늠하도록.
                        if (activeTool !== 'select' && activeTool !== 'eyedropper') return;
                        if (isPanningRef.current) return;
                        if (part.locked === true) return;
                        const members = getGroupMemberIds(part.id);
                        setHoveredPartIds(
                          new Set(members.length > 1 ? members : [part.id]),
                        );
                      }}
                      onMouseLeave={() => {
                        // 그룹 멤버 간 빠른 이동 시 leave→enter 순서가 역전될 수 있어
                        // 현재 hover 집합에 이 파트가 있을 때만 클리어 — 다른 부분으로
                        // 옮긴 hover 가 잘못 지워지지 않도록.
                        setHoveredPartIds((prev) =>
                          prev.has(part.id) ? new Set() : prev,
                        );
                      }}
                      onDragStart={(e) => {
                        // Shift 없이 드래그하면 클릭처럼 단일 선택부터.
                        if (!selectedSet.has(part.id)) {
                          const additive = e.evt.shiftKey;
                          selectPart(part.id, additive);
                        }
                        // shift-축스냅 기준점 — absolute 좌표에서 시작점을 캡처.
                        dragStartAbsRef.current.set(part.id, e.target.absolutePosition());
                        // 스냅 후보 계산 — 같은 그룹 멤버는 함께 움직이므로 모두 제외.
                        const groupExclude = new Set(getGroupMemberIds(part.id));
                        snapTargetsRef.current = buildSnapTargets(groupExclude, null);
                        beginPartOp();
                        // part 이동/드래그 시작 → 그라디언트 popover·핸들 자동 닫힘.
                        setGradientPanelOpen(false);
                      }}
                      dragBoundFunc={(pos) => {
                        // 1) 가이드 스냅 먼저 (Alt 누름 시 비활성).
                        const t = part.transform ?? DEFAULT_TRANSFORM;
                        const sx = Math.abs(t.scaleX || 1);
                        const sy = Math.abs(t.scaleY || 1);
                        const snapped = snapDragWithGuides(
                          pos,
                          { x: t.x, y: t.y },
                          part.bounding_box,
                          { sx, sy },
                        );
                        applyGuides(snapped.guides);
                        // 2) shift 축스냅 — 이미 스냅된 좌표 위에서 다시 적용.
                        return snapDragToAxis(part.id, snapped.posAbs);
                      }}
                      onDragMove={(e) => syncSelectionOverlay(part.id, e.target)}
                      onDragEnd={(e) => {
                        commitNodeTransformBatched(part.id, e.target);
                        dragStartAbsRef.current.delete(part.id);
                        // 가이드 비우기.
                        applyGuides({ vertical: [], horizontal: [] });
                      }}
                      onTransformStart={() => {
                        beginPartOp();
                        // 변형 시작 → 그라디언트 popover·핸들 자동 닫힘.
                        setGradientPanelOpen(false);
                      }}
                      onTransform={(e) => syncSelectionOverlay(part.id, e.target)}
                      onTransformEnd={(e) => commitNodeTransformBatched(part.id, e.target)}
                    />
                    {/* 비-브러쉬 파트 선택/호버 표시: 메인 Path 위에 그리는 파란 중앙선 한 줄.
                        Illustrator 처럼 stroke 두께와 무관하게 패스 중심선을 따라 가는 얇은 선 하나만
                        보인다(예전: stroke 바깥쪽 링). 브러쉬 파트는 메인 Path 자체가 파란 spine 으로
                        바뀌므로 별도 오버레이가 필요 없다. */}
                    {showSelection && !hasBrush ? (
                      <Path
                        ref={(node) => {
                          if (node) selectionOverlayNodeMap.current.set(part.id, node);
                          else selectionOverlayNodeMap.current.delete(part.id);
                        }}
                        data={pathData}
                        listening={false}
                        fillEnabled={false}
                        stroke={SELECTION_STROKE}
                        strokeWidth={overlayStrokeWidth}
                        lineCap={part.stroke_linecap}
                        lineJoin={part.stroke_linejoin}
                        x={transform.x}
                        y={transform.y}
                        rotation={transform.rotation}
                        scaleX={transform.scaleX}
                        scaleY={transform.scaleY}
                        visible={part.visible !== false}
                      />
                    ) : null}
                    {hasBrush ? <BrushLayer part={part} sketch={sketch} /> : null}
                    </Fragment>
                  );
                })}

              {/* ── 그라디언트 핸들 (Figma 스타일) ─────────────────────────
                  선택된 단일 part 의 fill 이 linear/radial 일 때:
                  - 양 끝점에 작은 흰 원 (위치 = axis 의 양 끝, 드래그로 axis 이동)
                  - 두 끝점 잇는 라인 (정적 — 시각용)
                  - 각 stop 마다 라인 위 색 사각형 swatch — 드래그하면 axis 위로 projection 되어
                    offset 만 변경 (색의 위치 = 그라디언트 분포 직접 편집).
                  select 도구에서만 노출. */}
              {activeTool === 'select' && sketch && selectedPartIds.length === 1 && isGradientPanelOpen &&
                (() => {
                  const gPart = sketch.parts.find((p) => p.id === selectedPartIds[0]);
                  if (!gPart) return null;
                  const rawFill = gPart.fill;
                  if (typeof rawFill === 'string') return null;
                  if (rawFill.kind !== 'linear' && rawFill.kind !== 'radial') return null;
                  const partId = gPart.id;
                  const t = gPart.transform ?? DEFAULT_TRANSFORM;
                  const sx = viewport.zoom * Math.abs(t.scaleX || 1);
                  const sy = viewport.zoom * Math.abs(t.scaleY || 1);
                  const lineW = 1 / Math.max(sx, sy);
                  // 끝점 동그라미 = axis 이동 핸들 (드래그). swatch = axis 옆 말풍선 (offset 만 변경).
                  // 둘이 겹치지 않도록 swatch 를 axis 의 normal 방향으로 offset.
                  const endR = 6 / Math.max(sx, sy);
                  const endHit = 16 / Math.max(sx, sy);
                  const stopSide = 16 / Math.max(sx, sy);
                  const stopHalf = stopSide / 2;
                  const stopHit = 20 / Math.max(sx, sy);
                  const stopOffsetDist = 17 / Math.max(sx, sy); // axis 라인 ↔ swatch 중심 거리 (꼬리 짧게)

                  // 두 끝점 좌표. linear: (x1,y1)~(x2,y2). radial: (fx,fy)~(cx+r1, cy).
                  const p0 = rawFill.kind === 'linear'
                    ? { x: rawFill.x1, y: rawFill.y1 }
                    : { x: rawFill.fx, y: rawFill.fy };
                  const p1 = rawFill.kind === 'linear'
                    ? { x: rawFill.x2, y: rawFill.y2 }
                    : { x: rawFill.cx + rawFill.r1, y: rawFill.cy };
                  const dx = p1.x - p0.x;
                  const dy = p1.y - p0.y;
                  const axisLen = Math.sqrt(dx * dx + dy * dy);
                  // axis 의 수직 normal — swatch 를 axis 옆으로 빼는 방향. axis 가 너무 짧으면
                  // 위쪽으로 폴백. 한 쪽으로 일관되어야 swatch 끼리 겹치지 않음.
                  const normal = axisLen > 1e-6
                    ? { x: -dy / axisLen, y: dx / axisLen }
                    : { x: 0, y: -1 };

                  // axis 위 t∈[0,1] → 좌표.
                  const onAxis = (tt: number) => ({
                    x: p0.x + dx * tt,
                    y: p0.y + dy * tt,
                  });
                  // 그 점에서 normal 방향으로 stopOffsetDist 만큼 빠진 swatch 중심.
                  const onSwatch = (tt: number) => {
                    const c = onAxis(tt);
                    return { x: c.x + normal.x * stopOffsetDist, y: c.y + normal.y * stopOffsetDist };
                  };

                  // 끝점 동그라미 = axis 끝점 이동 핸들. swatch 와 분리되어 충돌 없음.
                  function applyEndpoint(which: 0 | 1, nx: number, ny: number) {
                    const cur = useEditorStore.getState().sketch?.parts.find((p) => p.id === partId)?.fill;
                    if (!cur || typeof cur === 'string') return;
                    if (cur.kind === 'linear') {
                      if (which === 0) updatePartStyle(partId, { fill: { ...cur, x1: nx, y1: ny } });
                      else updatePartStyle(partId, { fill: { ...cur, x2: nx, y2: ny } });
                    } else if (cur.kind === 'radial') {
                      if (which === 0) {
                        const ddx = nx - cur.fx;
                        const ddy = ny - cur.fy;
                        updatePartStyle(partId, {
                          fill: { ...cur, fx: nx, fy: ny, cx: cur.cx + ddx, cy: cur.cy + ddy },
                        });
                      } else {
                        const rdx = nx - cur.cx;
                        const rdy = ny - cur.cy;
                        const r = Math.max(Math.sqrt(rdx * rdx + rdy * rdy), 1);
                        updatePartStyle(partId, { fill: { ...cur, r1: r } });
                      }
                    }
                  }

                  // stop swatch 드래그 — 마우스 위치(swatch 중심)에서 axis 로 다시 projection 후 offset 만.
                  // 마우스가 normal 방향으로 빠져 있어도 axis 로 정확히 정사영해 offset 갱신.
                  function applyStopDrag(idx: number, swatchCx: number, swatchCy: number) {
                    const cur = useEditorStore.getState().sketch?.parts.find((p) => p.id === partId)?.fill;
                    if (!cur || typeof cur === 'string') return;
                    if (cur.kind !== 'linear' && cur.kind !== 'radial') return;
                    const p0c = cur.kind === 'linear' ? { x: cur.x1, y: cur.y1 } : { x: cur.fx, y: cur.fy };
                    const p1c = cur.kind === 'linear'
                      ? { x: cur.x2, y: cur.y2 }
                      : { x: cur.cx + cur.r1, y: cur.cy };
                    const ddx = p1c.x - p0c.x;
                    const ddy = p1c.y - p0c.y;
                    const len = ddx * ddx + ddy * ddy;
                    if (len <= 1e-6) return;
                    // swatch 중심을 normal 만큼 axis 쪽으로 다시 빼서 axis 위 점으로 환원.
                    const al = Math.sqrt(len);
                    const nrm = { x: -ddy / al, y: ddx / al };
                    const ax = swatchCx - nrm.x * stopOffsetDist;
                    const ay = swatchCy - nrm.y * stopOffsetDist;
                    const tt = Math.max(
                      0,
                      Math.min(1, ((ax - p0c.x) * ddx + (ay - p0c.y) * ddy) / len),
                    );
                    const stops = cur.stops.map((ss, k) =>
                      k === idx ? { ...ss, offset: tt } : { ...ss },
                    );
                    updatePartStyle(partId, { fill: { ...cur, stops } });
                  }

                  return (
                    <Group
                      x={t.x}
                      y={t.y}
                      rotation={t.rotation}
                      scaleX={t.scaleX}
                      scaleY={t.scaleY}
                      listening
                    >
                      {/* 두 끝점 잇는 라인 — 정적, 시각 가이드만. 흰 underlay + 어두운 overlay 로 어떤 배경에서도 보이게. */}
                      <Line
                        points={[p0.x, p0.y, p1.x, p1.y]}
                        stroke="#ffffff"
                        strokeWidth={lineW * 2.4}
                        listening={false}
                        perfectDrawEnabled={false}
                      />
                      <Line
                        points={[p0.x, p0.y, p1.x, p1.y]}
                        stroke="rgba(0,0,0,0.55)"
                        strokeWidth={lineW}
                        listening={false}
                        perfectDrawEnabled={false}
                      />
                      {/* stop 마다 — axis 쪽 변의 가운데에서 axis 위 한 점까지 뻗어나가는
                          삼각형(말풍선 꼬리) + axis 옆 색 사각형.
                          드래그는 axis 방향으로만 슬라이드 — normal 방향은 잠겨 swatch 가 axis
                          에 평행 이동만 함. 끝점 동그라미와 위치가 분리되어 충돌 없음. */}
                      {rawFill.stops.map((s, i) => {
                        const swatchPt = onSwatch(s.offset);
                        const isStopSel = i === selectedStopIndex;
                        // 정삼각형 꼬리: swatch 의 axis 쪽 변 가운데(base)에서 axis 방향으로 뻗는다.
                        // base 두 점 + tip 한 점이 정삼각형을 이루도록 height = halfBase * √3 으로 잡고,
                        // 흰색으로 가득 채운 작은 삼각형으로 그린다.
                        const axisDir = axisLen > 1e-6
                          ? { x: dx / axisLen, y: dy / axisLen }
                          : { x: 1, y: 0 };
                        const tailBaseHalf = stopSide * 0.13; // 더 작게
                        const tailHeight = tailBaseHalf * Math.sqrt(3); // 정삼각형
                        const baseCenter = {
                          x: swatchPt.x - normal.x * stopHalf,
                          y: swatchPt.y - normal.y * stopHalf,
                        };
                        const tipPt = {
                          x: baseCenter.x - normal.x * tailHeight,
                          y: baseCenter.y - normal.y * tailHeight,
                        };
                        const baseL = {
                          x: baseCenter.x - axisDir.x * tailBaseHalf,
                          y: baseCenter.y - axisDir.y * tailBaseHalf,
                        };
                        const baseR = {
                          x: baseCenter.x + axisDir.x * tailBaseHalf,
                          y: baseCenter.y + axisDir.y * tailBaseHalf,
                        };
                        return (
                          <Group key={i} listening>
                            {/* 말풍선 꼬리 — 정삼각형. 선택 시 swatch 와 함께 파란색으로 강조. */}
                            <Line
                              points={[baseL.x, baseL.y, tipPt.x, tipPt.y, baseR.x, baseR.y]}
                              closed
                              fill={isStopSel ? SELECTION_STROKE : '#ffffff'}
                              stroke={isStopSel ? SELECTION_STROKE : '#ffffff'}
                              strokeWidth={lineW * 1.4}
                              listening={false}
                              perfectDrawEnabled={false}
                            />
                            {/* 색 사각형 — 드래그하면 axis 위로 projection 되어 offset 만 변경.
                                onDragMove 에서 node 위치를 매번 axis projection 결과로 강제해
                                normal 방향 이동을 잠근다. */}
                            <Rect
                              x={swatchPt.x - stopHalf}
                              y={swatchPt.y - stopHalf}
                              width={stopSide}
                              height={stopSide}
                              cornerRadius={2 / Math.max(sx, sy)}
                              fill={s.color}
                              stroke={isStopSel ? SELECTION_STROKE : '#ffffff'}
                              strokeWidth={isStopSel ? lineW * 2.6 : lineW * 2}
                              hitStrokeWidth={stopHit}
                              shadowColor="rgba(0,0,0,0.35)"
                              shadowBlur={lineW * 2}
                              shadowOffset={{ x: 0, y: lineW }}
                              draggable
                              perfectDrawEnabled={false}
                              onMouseDown={(e) => { e.cancelBubble = true; setSelectedStopIndex(i); }}
                              onDragStart={beginAnchorDrag}
                              onDragMove={(e) => {
                                const node = e.target;
                                const cx = node.x() + stopHalf;
                                const cy = node.y() + stopHalf;
                                applyStopDrag(i, cx, cy);
                                // 드래그 전체를 단일 undo 스텝으로 — 첫 move 의 pre-drag 스냅샷 직후 멈춘다.
                                markFirstDragMove();
                                // 노드 위치 즉시 axis projection 결과로 강제 — normal 방향 잠금.
                                const cur = useEditorStore.getState().sketch?.parts.find((p) => p.id === partId)?.fill;
                                if (cur && typeof cur !== 'string' && (cur.kind === 'linear' || cur.kind === 'radial')) {
                                  const newOff = cur.stops[i]?.offset;
                                  if (newOff !== undefined) {
                                    const sw = onSwatch(newOff);
                                    node.x(sw.x - stopHalf);
                                    node.y(sw.y - stopHalf);
                                  }
                                }
                              }}
                              onDragEnd={(e) => {
                                const node = e.target;
                                const cx = node.x() + stopHalf;
                                const cy = node.y() + stopHalf;
                                applyStopDrag(i, cx, cy);
                                endAnchorDrag();
                              }}
                            />
                          </Group>
                        );
                      })}
                      {/* 양 끝점 원 — axis 이동 핸들 (드래그). swatch 와 분리되어 정확히 잡힘.
                          stop swatch 위에 그려 위치가 겹쳐도 hit 우선순위가 끝점 원에 가도록. */}
                      <Circle
                        x={p0.x}
                        y={p0.y}
                        radius={endR}
                        fill="#ffffff"
                        stroke={SELECTION_STROKE}
                        strokeWidth={lineW * 1.6}
                        hitStrokeWidth={endHit}
                        draggable
                        perfectDrawEnabled={false}
                        onMouseDown={(e) => { e.cancelBubble = true; }}
                        onDragStart={beginAnchorDrag}
                        onDragMove={(e) => { applyEndpoint(0, e.target.x(), e.target.y()); markFirstDragMove(); }}
                        onDragEnd={(e) => { applyEndpoint(0, e.target.x(), e.target.y()); endAnchorDrag(); }}
                      />
                      <Circle
                        x={p1.x}
                        y={p1.y}
                        radius={endR}
                        fill="#ffffff"
                        stroke="rgba(0,0,0,0.55)"
                        strokeWidth={lineW * 1.6}
                        hitStrokeWidth={endHit}
                        draggable
                        perfectDrawEnabled={false}
                        onMouseDown={(e) => { e.cancelBubble = true; }}
                        onDragStart={beginAnchorDrag}
                        onDragMove={(e) => { applyEndpoint(1, e.target.x(), e.target.y()); markFirstDragMove(); }}
                        onDragEnd={(e) => { applyEndpoint(1, e.target.x(), e.target.y()); endAnchorDrag(); }}
                      />
                    </Group>
                  );
                })()}

              {/* ── Anchor/handle 인터랙티브 오버레이 ───────────────────────
                  선택된 모든 파트의 베지어 구조를 일러스트레이터처럼 시각화·편집.
                  Group의 transform을 Path와 동일하게 맞춰야 anchor의 path-로컬 좌표가
                  같은 화면 위치에 정렬된다. 부모 listening=false면 자식 이벤트도 차단되므로
                  오버레이 Group은 listening=true, 비-인터랙티브 가이드라인만 listening=false.
                  직접 선택(A) 도구에서만 표시 — 검은 화살표(V) 모드에선 파트 이동/회전이
                  주 동작이라 앵커 표시가 시각적으로 방해된다.
                  다중 part 가 선택돼 있으면 각 파트의 anchor 가 동시에 표시되어 path 간 연결
                  (Ctrl+J) 같은 cross-part 편집이 가능해진다. */}
              {activeTool === 'direct-select' && sketch && selectedPartIds.map((selPartId) => {
                const overlayPart = sketch.parts.find((p) => p.id === selPartId);
                if (!overlayPart || overlayPart.anchors.length === 0) return null;
                const t = overlayPart.transform ?? DEFAULT_TRANSFORM;
                // 화면 픽셀을 path-로컬 좌표로 환산. transform.scale도 곱해져 들어가므로
                // scale이 적용된 파트에서도 화면상 크기는 동일하게 유지된다.
                const sx = viewport.zoom * Math.abs(t.scaleX || 1);
                const sy = viewport.zoom * Math.abs(t.scaleY || 1);
                const anchorHalfX = ANCHOR_SIDE_PX / 2 / sx;
                const anchorHalfY = ANCHOR_SIDE_PX / 2 / sy;
                // Konva.Circle은 단일 radius라 평균을 사용 — 비균등 scale에서 약간 타원이지만
                // 시각적 가이드 용도라 충분.
                const handleRadius = (HANDLE_RADIUS_PX / sx + HANDLE_RADIUS_PX / sy) / 2;
                const lineStrokeWidth = OVERLAY_STROKE_WIDTH_PX / Math.max(sx, sy);
                const partId = overlayPart.id;
                // anchor·handle 호버 시 cursor를 건드리지 않는다 — direct-select 도구의
                // SVG 커서를 그대로 유지해야 모드가 분명히 보인다.
                return (
                  <Group
                    key={overlayPart.id}
                    x={t.x}
                    y={t.y}
                    rotation={t.rotation}
                    scaleX={t.scaleX}
                    scaleY={t.scaleY}
                    listening
                  >
                    {overlayPart.anchors.map((a) => {
                      const isAnchorSel = selectedAnchors.some(
                        (r) => r.partId === partId && r.anchorId === a.id,
                      );
                      return (
                      <Group key={a.id} listening>
                        {a.handle_in && (
                          <Line
                            points={[a.x, a.y, a.handle_in.x, a.handle_in.y]}
                            stroke={SELECTION_STROKE}
                            strokeWidth={lineStrokeWidth}
                            listening={false}
                            perfectDrawEnabled={false}
                          />
                        )}
                        {a.handle_out && (
                          <Line
                            points={[a.x, a.y, a.handle_out.x, a.handle_out.y]}
                            stroke={SELECTION_STROKE}
                            strokeWidth={lineStrokeWidth}
                            listening={false}
                            perfectDrawEnabled={false}
                          />
                        )}
                        {a.handle_in && (
                          <Circle
                            x={a.handle_in.x}
                            y={a.handle_in.y}
                            radius={handleRadius}
                            fill="#ffffff"
                            stroke={SELECTION_STROKE}
                            strokeWidth={lineStrokeWidth}
                            draggable
                            perfectDrawEnabled={false}
                            // hitStrokeWidth로 작은 원의 클릭 가용 영역 확장 — 화면 픽셀 기준 8px.
                            hitStrokeWidth={8 / Math.max(sx, sy)}
                            onMouseDown={(e) => {
                              // Stage 패닝/마퀴로 이벤트 전파 차단.
                              e.cancelBubble = true;
                            }}
                            onDragStart={beginAnchorDrag}
                            onDragMove={(e) => {
                              const node = e.target;
                              updateHandle(partId, a.id, 'in', node.x(), node.y());
                              markFirstDragMove();
                            }}
                            onDragEnd={(e) => {
                              const node = e.target;
                              updateHandle(partId, a.id, 'in', node.x(), node.y());
                              endAnchorDrag();
                            }}
                          />
                        )}
                        {a.handle_out && (
                          <Circle
                            x={a.handle_out.x}
                            y={a.handle_out.y}
                            radius={handleRadius}
                            fill="#ffffff"
                            stroke={SELECTION_STROKE}
                            strokeWidth={lineStrokeWidth}
                            draggable
                            perfectDrawEnabled={false}
                            hitStrokeWidth={8 / Math.max(sx, sy)}
                            onMouseDown={(e) => {
                              e.cancelBubble = true;
                            }}
                            onDragStart={beginAnchorDrag}
                            onDragMove={(e) => {
                              const node = e.target;
                              updateHandle(partId, a.id, 'out', node.x(), node.y());
                              markFirstDragMove();
                            }}
                            onDragEnd={(e) => {
                              const node = e.target;
                              updateHandle(partId, a.id, 'out', node.x(), node.y());
                              endAnchorDrag();
                            }}
                          />
                        )}
                        <Rect
                          // Rect의 x/y가 좌상단이라 anchor.x/y에서 half만큼 빼서 그렸지만,
                          // 드래그 시 node.x()는 그 좌상단 좌표가 되므로 onDragMove에서 다시 half를 더해야
                          // anchor의 중심 좌표로 환산된다.
                          x={a.x - anchorHalfX}
                          y={a.y - anchorHalfY}
                          width={anchorHalfX * 2}
                          height={anchorHalfY * 2}
                          // 선택된 anchor: 채움은 selection 색(파란색), 테두리는 흰색 — 같은 파란색 path
                          // 위에 올라가도 흰 테두리 덕에 사각형 윤곽이 끊기지 않고 보인다.
                          // 비선택: 흰 채움 + 파란 테두리(일러스트레이터 표준 hollow anchor 모양).
                          // 선택 상태에선 stroke를 약간 더 굵게 줘서 채움색과 함께 시각 강조도를 한 단계 올린다.
                          fill={isAnchorSel ? SELECTION_STROKE : '#ffffff'}
                          stroke={isAnchorSel ? '#ffffff' : SELECTION_STROKE}
                          strokeWidth={isAnchorSel ? lineStrokeWidth * 1.5 : lineStrokeWidth}
                          draggable
                          perfectDrawEnabled={false}
                          hitStrokeWidth={8 / Math.max(sx, sy)}
                          onMouseDown={(e) => {
                            // Stage mousedown으로 버블링되어 마퀴/패닝이 시작되는 것만 막는다.
                            // 여기서 setState(selectAnchor 등)를 호출하면 react-konva가 드래그를
                            // 초기화하기 전에 props를 재적용해 Konva의 drag 셋업이 취소된다 →
                            // 클릭만 잡힌 채 드래그가 안 먹는 증상. 선택은 onDragStart/onClick로.
                            e.cancelBubble = true;
                          }}
                          onContextMenu={(e) => handleAnchorContextMenu(e, partId, a.id)}
                          onDragStart={(e) => {
                            // 드래그가 실제로 시작된 시점이라 setState를 안전하게 호출 가능.
                            beginAnchorDrag();
                            // 이미 선택된 anchor 면 selection 그대로 유지(다중 anchor 동시 이동),
                            // 아니면 이 anchor 만 선택. Shift 는 선택에 추가.
                            const alreadySelected = useEditorStore
                              .getState()
                              .selectedAnchors.some(
                                (r) => r.partId === partId && r.anchorId === a.id,
                              );
                            if (e.evt.shiftKey) {
                              if (!alreadySelected)
                                addAnchorsToSelection([{ partId, anchorId: a.id }]);
                            } else if (!alreadySelected) {
                              selectAnchor(a.id, partId);
                            }
                            // 드래그 동시 이동 대상은 dragStart 직후의 selection 스냅샷.
                            const refs = useEditorStore.getState().selectedAnchors.slice();
                            dragAnchorRefsRef.current = refs.length > 0
                              ? refs
                              : [{ partId, anchorId: a.id }];
                            lastDragAnchorPosRef.current = { x: a.x, y: a.y };
                          }}
                          onClick={(e) => {
                            // 드래그가 일어나지 않은 순수 클릭만 여기로 들어옴.
                            if (e.evt.altKey) {
                              e.cancelBubble = true;
                              const next = a.kind === 'corner' ? 'smooth' : 'corner';
                              setAnchorKind(partId, a.id, next);
                              return;
                            }
                            if (e.evt.shiftKey) {
                              toggleAnchorInSelection({ partId, anchorId: a.id });
                            } else {
                              selectAnchor(a.id, partId);
                            }
                          }}
                          onDragMove={(e) => {
                            const node = e.target;
                            const newX = node.x() + anchorHalfX;
                            const newY = node.y() + anchorHalfY;
                            const refs = dragAnchorRefsRef.current;
                            const last = lastDragAnchorPosRef.current;
                            if (refs && refs.length > 1 && last) {
                              const dx = newX - last.x;
                              const dy = newY - last.y;
                              if (dx !== 0 || dy !== 0) {
                                translateAnchors(refs, dx, dy);
                                lastDragAnchorPosRef.current = { x: newX, y: newY };
                              }
                            } else {
                              updateAnchorPosition(partId, a.id, newX, newY);
                              lastDragAnchorPosRef.current = { x: newX, y: newY };
                            }
                            markFirstDragMove();
                          }}
                          onDragEnd={(e) => {
                            const node = e.target;
                            const newX = node.x() + anchorHalfX;
                            const newY = node.y() + anchorHalfY;
                            const refs = dragAnchorRefsRef.current;
                            const last = lastDragAnchorPosRef.current;
                            if (refs && refs.length > 1 && last) {
                              const dx = newX - last.x;
                              const dy = newY - last.y;
                              if (dx !== 0 || dy !== 0) translateAnchors(refs, dx, dy);
                            } else {
                              updateAnchorPosition(partId, a.id, newX, newY);
                            }
                            // 드래그 끝에 자동 닫기: 드롭한 endpoint 가 같은 서브패스의 반대편
                            // endpoint 와 화면상 ~8px 이내라면 정확히 그 위치로 스냅하고 서브패스를 닫는다.
                            // (snapEps 는 화면 8px 를 part-local 단위로 환산 — 작은 쪽 scale 로 나눠 lenient 하게.)
                            // 단, 실제 드래그 이동이 없었으면 (= 그냥 클릭) 의도치 않은 닫힘 방지를 위해 skip.
                            // dragHistoryPendingRef 는 dragStart 에서 true, 첫 dragMove 에서 false 로 바뀌므로,
                            // 여기서 false 라는 건 실제로 한 번 이상 움직였다는 뜻.
                            if (!dragHistoryPendingRef.current) {
                              const snapEps = 8 / Math.min(sx, sy);
                              const targetRefs = refs && refs.length > 0
                                ? refs
                                : [{ partId, anchorId: a.id }];
                              trySnapCloseAtAnchors(targetRefs, snapEps);
                            }
                            dragAnchorRefsRef.current = null;
                            lastDragAnchorPosRef.current = null;
                            endAnchorDrag();
                          }}
                        />
                      </Group>
                      );
                    })}
                  </Group>
                );
              })}

              {/* ── 펜툴 시각화 ─────────────────────────────────────────────
                  드래프트 진행 중일 때만 표시. listening=false라 클릭/드래그는 모두 stage가
                  먼저 받아 펜 로직(새 anchor 추가/닫기/click-drag handle 만들기)으로 들어간다. */}
              {activeTool === 'pen' && (() => {
                const draftId = penDraftPartIdRef.current;
                if (!draftId) return null;
                const draft = sketch?.parts.find((p) => p.id === draftId);
                if (!draft || draft.anchors.length === 0) return null;
                const t = draft.transform ?? DEFAULT_TRANSFORM;
                const sx = viewport.zoom * Math.abs(t.scaleX || 1);
                const sy = viewport.zoom * Math.abs(t.scaleY || 1);
                const anchorHalfX = ANCHOR_SIDE_PX / 2 / sx;
                const anchorHalfY = ANCHOR_SIDE_PX / 2 / sy;
                const handleRadius = (HANDLE_RADIUS_PX / sx + HANDLE_RADIUS_PX / sy) / 2;
                const lineStrokeWidth = OVERLAY_STROKE_WIDTH_PX / Math.max(sx, sy);
                const last = draft.anchors[draft.anchors.length - 1]!;
                // Rubber-band: 마지막 anchor가 cubic용 handle_out을 갖고 있으면 그 handle을 그대로 활용해
                // cubic 미리보기를 그린다(끝점 control은 cursor 자체로 폴백 → 직선과 자연스럽게 이어짐).
                // 없으면 단순 직선 미리보기.
                const previewD = penPreviewCursor
                  ? last.handle_out
                    ? `M ${last.x} ${last.y} C ${last.handle_out.x} ${last.handle_out.y} ${penPreviewCursor.x} ${penPreviewCursor.y} ${penPreviewCursor.x} ${penPreviewCursor.y}`
                    : `M ${last.x} ${last.y} L ${penPreviewCursor.x} ${penPreviewCursor.y}`
                  : null;
                return (
                  <Group
                    x={t.x}
                    y={t.y}
                    rotation={t.rotation}
                    scaleX={t.scaleX}
                    scaleY={t.scaleY}
                    listening={false}
                  >
                    {previewD && (
                      <Path
                        data={previewD}
                        stroke={SELECTION_STROKE}
                        strokeWidth={lineStrokeWidth}
                        dash={[4 / Math.max(sx, sy), 3 / Math.max(sx, sy)]}
                        listening={false}
                        perfectDrawEnabled={false}
                      />
                    )}
                    {draft.anchors.map((a) => (
                      <Group key={a.id} listening={false}>
                        {a.handle_in && (
                          <Line
                            points={[a.x, a.y, a.handle_in.x, a.handle_in.y]}
                            stroke={SELECTION_STROKE}
                            strokeWidth={lineStrokeWidth}
                            listening={false}
                            perfectDrawEnabled={false}
                          />
                        )}
                        {a.handle_out && (
                          <Line
                            points={[a.x, a.y, a.handle_out.x, a.handle_out.y]}
                            stroke={SELECTION_STROKE}
                            strokeWidth={lineStrokeWidth}
                            listening={false}
                            perfectDrawEnabled={false}
                          />
                        )}
                        {a.handle_in && (
                          <Circle
                            x={a.handle_in.x}
                            y={a.handle_in.y}
                            radius={handleRadius}
                            fill="#ffffff"
                            stroke={SELECTION_STROKE}
                            strokeWidth={lineStrokeWidth}
                            listening={false}
                            perfectDrawEnabled={false}
                          />
                        )}
                        {a.handle_out && (
                          <Circle
                            x={a.handle_out.x}
                            y={a.handle_out.y}
                            radius={handleRadius}
                            fill="#ffffff"
                            stroke={SELECTION_STROKE}
                            strokeWidth={lineStrokeWidth}
                            listening={false}
                            perfectDrawEnabled={false}
                          />
                        )}
                        <Rect
                          x={a.x - anchorHalfX}
                          y={a.y - anchorHalfY}
                          width={anchorHalfX * 2}
                          height={anchorHalfY * 2}
                          fill="#ffffff"
                          stroke={SELECTION_STROKE}
                          strokeWidth={lineStrokeWidth}
                          listening={false}
                          perfectDrawEnabled={false}
                        />
                      </Group>
                    ))}
                  </Group>
                );
              })()}

              {/* 선택된 파트들에 붙는 변형 핸들 */}
              <Transformer
                ref={transformerRef}
                rotateEnabled
                keepRatio={false}
                anchorSize={8}
                borderStroke={SELECTION_STROKE}
                anchorStroke={SELECTION_STROKE}
                anchorFill="#ffffff"
                rotateAnchorOffset={24}
                // 너무 작아지지 않도록 최소 크기 가드.
                boundBoxFunc={(_oldBox, newBox) => {
                  if (Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4) {
                    return _oldBox;
                  }
                  return newBox;
                }}
              />

              {/* 선택된 대지에 붙는 리사이즈 핸들 — 회전 비활성. */}
              <Transformer
                ref={artboardTransformerRef}
                rotateEnabled={false}
                keepRatio={false}
                anchorSize={8}
                borderStroke={SELECTION_STROKE}
                anchorStroke={SELECTION_STROKE}
                anchorFill="#ffffff"
                boundBoxFunc={(_oldBox, newBox) => {
                  if (Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4) {
                    return _oldBox;
                  }
                  return newBox;
                }}
              />

              {/* 마퀴 박스 */}
              {marquee && (
                <Rect
                  x={marquee.x}
                  y={marquee.y}
                  width={marquee.width}
                  height={marquee.height}
                  fill={SELECTION_FILL}
                  stroke={SELECTION_STROKE}
                  strokeWidth={1 / viewport.zoom}
                  listening={false}
                />
              )}

              {/* 스냅 가이드 라인 — 시안색, 1px 두께, 화면 전체에 걸쳐 늘어진다.
                  vertical은 x 고정 세로선, horizontal은 y 고정 가로선. */}
              {snapGuides.vertical.map((vx, i) => {
                // viewport.x/zoom으로부터 화면에 보이는 world 영역 추정. 캔버스보다 충분히 길게 그려야
                // 줌-아웃 상태에서도 화면 끝까지 도달.
                const screenTop = -viewport.y / viewport.zoom;
                const screenBottom = (containerSize.height - viewport.y) / viewport.zoom;
                return (
                  <Line
                    key={`gv-${i}`}
                    points={[vx, screenTop, vx, screenBottom]}
                    stroke="#22d3ee"
                    strokeWidth={1 / viewport.zoom}
                    listening={false}
                    perfectDrawEnabled={false}
                  />
                );
              })}
              {snapGuides.horizontal.map((hy, i) => {
                const screenLeft = -viewport.x / viewport.zoom;
                const screenRight = (containerSize.width - viewport.x) / viewport.zoom;
                return (
                  <Line
                    key={`gh-${i}`}
                    points={[screenLeft, hy, screenRight, hy]}
                    stroke="#22d3ee"
                    strokeWidth={1 / viewport.zoom}
                    listening={false}
                    perfectDrawEnabled={false}
                  />
                );
              })}
            </Layer>
          </Stage>

          {/* 잡 진행 중 미리보기 오버레이 — 첫 번째 대지의 화면 좌표 위에 절대 배치.
              - jobStatus 'pending' (업로드 직후) / 'running' (폴링 중) 일 때만 보임.
              - 대지 Rect 의 흰 배경 위에 SVG/스피너를 겹쳐 띄운다.
              - viewport.x/y/zoom 이 바뀔 때마다 React 재렌더로 위치/크기가 따라간다.
                단, 스페이스/H 도구로 stage 를 native drag 패닝하는 동안에는 dragEnd
                전까지 viewport 가 갱신되지 않아 잠시 어긋날 수 있다 — 5-10초 생성 동안
                패닝은 드물어 무시. */}
          {(jobStatus === 'pending' || jobStatus === 'running') &&
            sketch?.artboards?.[0] &&
            (() => {
              const ab = sketch.artboards[0];
              const screenLeft = viewport.x + ab.x * viewport.zoom;
              const screenTop = viewport.y + ab.y * viewport.zoom;
              const screenW = ab.width * viewport.zoom;
              const screenH = ab.height * viewport.zoom;
              return (
                <div
                  className="absolute z-10 overflow-hidden pointer-events-none flex items-center justify-center"
                  style={{
                    left: screenLeft,
                    top: screenTop,
                    width: screenW,
                    height: screenH,
                  }}
                  aria-label="도식화 생성 진행"
                >
                  {previewParsed ? (
                    // Arrow 스트림 SVG — element 단위 React 키잉으로 새 path 만 그려지는 모션을 준다.
                    // 대지 사각형을 꽉 채우도록 h/w-full + preserveAspectRatio=meet.
                    <div
                      ref={previewWrapperRef}
                      className="vectorize-preview flex h-full w-full items-center justify-center"
                    >
                      <svg
                        viewBox={previewParsed.viewBox ?? undefined}
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-full w-full"
                        preserveAspectRatio="xMidYMid meet"
                      >
                        {previewParsed.preludeHtml && (
                          <g
                            dangerouslySetInnerHTML={{
                              __html: previewParsed.preludeHtml,
                            }}
                          />
                        )}
                        {previewParsed.elements.map((html, i) => {
                          const isLatest =
                            i === previewParsed.elements.length - 1 &&
                            !previewParsed.isFinal;
                          return (
                            <PreviewElement
                              key={i}
                              html={html}
                              isCurrent={isLatest}
                            />
                          );
                        })}
                      </svg>
                    </div>
                  ) : previewSvg ? (
                    // 폴백 — element 분해 실패 시 통째 innerHTML.
                    <div
                      ref={previewWrapperRef}
                      className="vectorize-preview flex h-full w-full items-center justify-center [&>svg]:h-full [&>svg]:w-full"
                      dangerouslySetInnerHTML={{ __html: previewSvg }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div
                        className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-300 border-t-neutral-700"
                        aria-hidden="true"
                      />
                      <p className="text-sm text-neutral-600">
                        AI가 도식화를 생성 중입니다...
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </>
      )}

      {contextMenu &&
        (() => {
          const isMac =
            typeof navigator !== 'undefined' &&
            /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
          const mod = isMac ? '⌘' : 'Ctrl';
          const uiToggleItem = {
            label: hideUI ? 'UI 보이기' : 'UI 숨기기',
            onSelect: () => toggleHideUI(),
          };

          let sections: ContextMenuSection[] = [];

          if (contextMenu.kind === 'parts') {
            const ids = contextMenu.targetIds;
            const parts = sketch?.parts ?? [];
            const targets = parts.filter((p) => ids.includes(p.id));
            const hasMulti = ids.length >= 2;
            const groupCount = new Set(
              targets.map((p) => p.group_id).filter((g): g is string => !!g),
            ).size;
            const anyLocked = targets.some((p) => p.locked === true);
            const anyHidden = targets.some((p) => p.visible === false);
            // 두 파트 모두 열린 엔드포인트를 가져야 '연결' 활성. 그 외(닫힌 패스만, 1개 선택,
            // 3개 이상 선택)는 비활성 상태로 라벨만 보인다 — 메뉴에서 기능 자체가 보이도록.
            const partA = ids.length === 2 ? parts.find((p) => p.id === ids[0]) : null;
            const partB = ids.length === 2 ? parts.find((p) => p.id === ids[1]) : null;
            const canConnectParts =
              !!partA && !!partB && hasOpenEndpoint(partA) && hasOpenEndpoint(partB);

            sections = [
              {
                items: [
                  { label: '복사', shortcut: `${mod}+C`, onSelect: () => copyParts(ids) },
                  { label: '붙여넣기', shortcut: `${mod}+V`, onSelect: () => pasteParts() },
                ],
              },
              {
                items: [
                  { label: '맨 앞으로 가져오기', shortcut: ']', onSelect: () => bringToFront(ids) },
                  { label: '맨 뒤로 보내기', shortcut: '[', onSelect: () => sendToBack(ids) },
                ],
              },
              {
                items: [
                  { label: '좌우 반전', shortcut: 'Shift+H', onSelect: () => flipPartsHorizontal(ids) },
                  { label: '상하 반전', shortcut: 'Shift+V', onSelect: () => flipPartsVertical(ids) },
                ],
              },
              {
                items: [
                  {
                    label: '패스 합치기',
                    shortcut: `${mod}+Shift+U`,
                    disabled: !hasMulti,
                    onSelect: () => unitePaths(ids),
                  },
                  {
                    label: '앞면 빼기',
                    disabled: !hasMulti,
                    onSelect: () => subtractPaths(ids),
                  },
                  {
                    label: '교집합',
                    disabled: !hasMulti,
                    onSelect: () => intersectPaths(ids),
                  },
                  {
                    label: '배제',
                    disabled: !hasMulti,
                    onSelect: () => excludePaths(ids),
                  },
                  {
                    label: '패스 분할',
                    shortcut: `${mod}+Alt+Shift+U`,
                    disabled: !hasMulti,
                    onSelect: () => dividePaths(ids),
                  },
                ],
              },
              {
                items: [
                  {
                    // 두 파트의 열린 엔드포인트 중 가장 가까운 한 쌍을 자동으로 골라 잇는다.
                    // 사용자는 파트만 두 개 잡으면 되고, 어느 끝점을 이을지는 거리로 결정.
                    label: '연결',
                    shortcut: `${mod}+J`,
                    disabled: !canConnectParts,
                    onSelect: () => {
                      if (!partA || !partB) return;
                      const pair = pickClosestOpenEndpointPair(partA, partB);
                      if (pair) joinAnchors(pair);
                    },
                  },
                ],
              },
              {
                items: [
                  {
                    label: '그룹 만들기',
                    shortcut: `${mod}+G`,
                    disabled: !hasMulti,
                    onSelect: () => groupParts(ids),
                  },
                  {
                    label: '그룹 해제',
                    shortcut: `${mod}+Shift+G`,
                    disabled: groupCount === 0,
                    onSelect: () => ungroupParts(ids),
                  },
                ],
              },
              {
                items: [
                  {
                    label: anyHidden ? '표시' : '숨기기',
                    shortcut: `${mod}+Shift+H`,
                    onSelect: () => toggleVisibility(ids),
                  },
                  {
                    label: anyLocked ? '잠금 해제' : '잠금',
                    shortcut: `${mod}+Shift+L`,
                    onSelect: () => toggleLock(ids),
                  },
                ],
              },
            ];
          } else if (contextMenu.kind === 'anchors') {
            // 직접 선택(A) 도구 — anchor 위 우클릭. 두 endpoint 가 잡혀 있으면 '연결' 활성.
            // 1개만 잡혀 있거나 endpoint 가 아닌 anchor 가 섞여 있으면 비활성.
            const refs = contextMenu.targetRefs;
            const parts = sketch?.parts ?? [];
            const allEndpoints =
              refs.length === 2 &&
              refs.every((r) => {
                const part = parts.find((p) => p.id === r.partId);
                return part ? isOpenEndpoint(part, r.anchorId) : false;
              });
            sections = [
              {
                items: [
                  {
                    label: '연결',
                    shortcut: `${mod}+J`,
                    disabled: !allEndpoints,
                    onSelect: () => joinAnchors(refs),
                  },
                ],
              },
            ];
          } else if (contextMenu.kind === 'artboard') {
            // 대지 메뉴 — 파트 위가 아닌 대지 배경을 우클릭한 경우.
            // 핵심 동작은 붙여넣기 / 이름 변경 / 대지 삭제. UI 토글도 함께 노출.
            const abId = contextMenu.artboardId;
            const ab = (sketch?.artboards ?? []).find((a) => a.id === abId);
            sections = [
              {
                items: [
                  { label: '붙여넣기', shortcut: `${mod}+V`, onSelect: () => pasteParts() },
                ],
              },
              {
                items: [
                  {
                    label: '대지 이름 변경',
                    onSelect: () => {
                      // window.prompt 가 가장 단순하고 자체적인 UX. 빈 문자열이면 변경 안 함.
                      const next = window.prompt('대지 이름', ab?.name ?? '');
                      if (next && next.trim()) updateArtboard(abId, { name: next.trim() });
                    },
                  },
                  {
                    label: '대지 삭제',
                    onSelect: () => deleteArtboard(abId),
                  },
                ],
              },
              { items: [uiToggleItem] },
            ];
          } else {
            // 빈 영역 — 사용자 요청대로 UI 토글 + 붙여넣기만.
            sections = [
              {
                items: [
                  uiToggleItem,
                  { label: '붙여넣기', shortcut: `${mod}+V`, onSelect: () => pasteParts() },
                ],
              },
            ];
          }

          return (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              sections={sections}
              onClose={() => setContextMenu(null)}
            />
          );
        })()}
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────
// 파트에 연결 가능한 열린 서브패스(엔드포인트)가 하나라도 있는지.
// '연결' 메뉴(parts kind) 활성화 조건 — 두 파트 모두 true 여야 한다.
function hasOpenEndpoint(part: Part): boolean {
  const breaks = part.subpath_breaks ?? [];
  const closed = part.subpath_closed ?? [];
  const starts = [0, ...breaks];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]!;
    const e = i + 1 < starts.length ? starts[i + 1]! : part.anchors.length;
    if (e > s && !closed[i]) return true;
  }
  return false;
}

// 두 파트의 열린 엔드포인트들을 모아 world 거리가 가장 짧은 (anchorA, anchorB) 쌍을 고른다.
// 사용자가 직접 endpoint 를 잡지 않고 파트 두 개만 선택해 우클릭 → '연결' 했을 때
// 가장 자연스러운 짝(가까운 끝점끼리)으로 자동 연결되도록 한다.
function pickClosestOpenEndpointPair(
  partA: Part,
  partB: Part,
): [AnchorRef, AnchorRef] | null {
  const epA = collectOpenEndpointWorld(partA);
  const epB = collectOpenEndpointWorld(partB);
  if (epA.length === 0 || epB.length === 0) return null;
  let bestA = epA[0]!.anchorId;
  let bestB = epB[0]!.anchorId;
  let bestDist = Infinity;
  for (const a of epA) {
    for (const b of epB) {
      const dx = a.wx - b.wx;
      const dy = a.wy - b.wy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestA = a.anchorId;
        bestB = b.anchorId;
      }
    }
  }
  return [
    { partId: partA.id, anchorId: bestA },
    { partId: partB.id, anchorId: bestB },
  ];
}

function collectOpenEndpointWorld(
  part: Part,
): { anchorId: string; wx: number; wy: number }[] {
  const breaks = part.subpath_breaks ?? [];
  const closed = part.subpath_closed ?? [];
  const starts = [0, ...breaks];
  const t = part.transform ?? DEFAULT_TRANSFORM;
  const rad = (t.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const out: { anchorId: string; wx: number; wy: number }[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < starts.length; i++) {
    if (closed[i]) continue;
    const sIdx = starts[i]!;
    const eIdx = i + 1 < starts.length ? starts[i + 1]! : part.anchors.length;
    if (sIdx >= eIdx) continue;
    for (const idx of [sIdx, eIdx - 1]) {
      if (seen.has(idx)) continue;
      seen.add(idx);
      const a = part.anchors[idx]!;
      const lx = a.x * t.scaleX;
      const ly = a.y * t.scaleY;
      out.push({
        anchorId: a.id,
        wx: lx * c - ly * s + t.x,
        wy: lx * s + ly * c + t.y,
      });
    }
  }
  return out;
}

// 우클릭 메뉴에서 '연결' 활성화 판정용 — anchor 가 열린 서브패스의 양끝 중 하나인지.
// store 의 findEndpointInfo 와 동일 로직. (그쪽은 export 안 됨.)
function isOpenEndpoint(part: Part, anchorId: string): boolean {
  const idx = part.anchors.findIndex((a) => a.id === anchorId);
  if (idx === -1) return false;
  const breaks = part.subpath_breaks ?? [];
  const closed = part.subpath_closed ?? [];
  const starts = [0, ...breaks];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]!;
    const e = i + 1 < starts.length ? starts[i + 1]! : part.anchors.length;
    if (s <= idx && idx < e) {
      if (closed[i]) return false;
      return idx === s || idx === e - 1;
    }
  }
  return false;
}

function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
