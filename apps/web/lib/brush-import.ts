// 사용자가 업로드한 SVG 문자열을 BrushDefinition(source:'user') 으로 변환한다.
// 브라우저 전용(DOMParser 사용) — 클라이언트 컴포넌트에서만 호출할 것.
//
// 좌표 규약(svg-schema/brushes.ts): 패스 진행 = +x, 법선 = +y, baseline = y=0.
// 따라서 반입 SVG 의 path 들을
//   - 가로: x 최소가 0 이 되도록 평행이동
//   - 세로: bbox 세로 중앙이 y=0 에 오도록 평행이동
// 한 뒤 side 타일 하나로 매핑한다.

import {
  BrushDefinitionSchema,
  type BrushDefinition,
} from '@sketchflat/svg-schema';

export interface ImportBrushOptions {
  name: string;
  category?: string;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// path d 문자열에서 좌표 숫자를 모두 뽑아 bbox 를 갱신한다.
// 정밀한 path 파싱이 아니라 "숫자 짝 = (x, y)" 단순 추정(요구사항 명시).
// 한계: arc 의 rx/ry/회전/플래그 같은 비-좌표 숫자도 x/y 로 섞여 들어가
//       bbox 가 다소 넉넉해질 수 있음. 미리보기/스케일 용도엔 충분.
function accumulateBoundsFromD(d: string, b: Bounds): boolean {
  // 부호/소수점/지수 표기를 포함한 숫자 토큰을 모두 추출.
  const nums = d.match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g);
  if (!nums || nums.length < 2) return false;

  let found = false;
  // 인접한 숫자를 (x, y) 짝으로 본다.
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = parseFloat(nums[i]);
    const y = parseFloat(nums[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minY = Math.min(b.minY, y);
    b.maxY = Math.max(b.maxY, y);
    found = true;
  }
  return found;
}

// path d 안의 모든 좌표 짝에 (dx, dy) 평행이동을 적용한 새 d 를 만든다.
// 숫자 토큰을 순서대로 (x, y) 짝으로 보고 짝수번째엔 dx, 홀수번째엔 dy 를 더한다.
// 한계: accumulateBoundsFromD 와 동일 — arc 파라미터 등 비-좌표 숫자도
//       이동돼 형태가 살짝 틀어질 수 있음. 단일 SVG 반입의 근사 변환.
function translateD(d: string, dx: number, dy: number): string {
  let idx = 0;
  return d.replace(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g, (token) => {
    const v = parseFloat(token);
    if (!Number.isFinite(v)) return token;
    const shifted = idx % 2 === 0 ? v + dx : v + dy;
    idx += 1;
    // 소수 자릿수 정리(부동소수 잡음 제거).
    return String(Math.round(shifted * 1000) / 1000);
  });
}

// 기본 도형 → path d 환산 (최소 지원: rect/line/circle).
function shapeToD(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  const num = (name: string) => parseFloat(el.getAttribute(name) ?? '');

  if (tag === 'rect') {
    const x = num('x') || 0;
    const y = num('y') || 0;
    const w = num('width');
    const h = num('height');
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
  }
  if (tag === 'line') {
    const x1 = num('x1');
    const y1 = num('y1');
    const x2 = num('x2');
    const y2 = num('y2');
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
    return `M${x1} ${y1} L${x2} ${y2}`;
  }
  if (tag === 'circle') {
    const cx = num('cx') || 0;
    const cy = num('cy') || 0;
    const r = num('r');
    if (!Number.isFinite(r)) return null;
    // 두 개의 반원 호로 원을 구성.
    return `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0`;
  }
  return null;
}

export function importBrushFromSvg(
  svgText: string,
  opts: ImportBrushOptions,
): BrushDefinition {
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser 를 사용할 수 없습니다 (서버 컨텍스트?).');
  }

  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('SVG 파싱에 실패했습니다.');
  }
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') {
    throw new Error('루트 요소가 <svg> 가 아닙니다.');
  }

  // path d 수집 + 기본 도형(rect/line/circle) 환산.
  const rawDs: string[] = [];
  doc.querySelectorAll('path').forEach((el) => {
    const d = el.getAttribute('d');
    if (d && d.trim()) rawDs.push(d.trim());
  });
  doc.querySelectorAll('rect, line, circle').forEach((el) => {
    const d = shapeToD(el);
    if (d) rawDs.push(d);
  });

  if (rawDs.length === 0) {
    throw new Error('반입할 <path>(또는 rect/line/circle) 가 없습니다.');
  }

  // 좌표 bbox 계산 (getBBox 는 비-렌더 환경에서 0 → 정규식 파싱이 안전).
  const bounds: Bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  let any = false;
  for (const d of rawDs) {
    if (accumulateBoundsFromD(d, bounds)) any = true;
  }
  if (
    !any ||
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxY)
  ) {
    throw new Error('SVG 좌표를 추출하지 못해 bbox 가 비었습니다.');
  }

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!(width > 0) || !(height > 0)) {
    throw new Error('SVG bbox 폭/높이가 0 입니다.');
  }

  // baseline 정규화 평행이동:
  //  - 가로: x 최소를 0 으로 → dx = -minX
  //  - 세로: bbox 세로 중앙을 0 으로 → midY = (minY+maxY)/2, dy = -midY
  const dx = -bounds.minX;
  const dy = -(bounds.minY + bounds.maxY) / 2;
  const paths = rawDs.map((d) => translateD(d, dx, dy));

  // 단일 SVG 는 side 타일로만 매핑.
  // TODO: 다중 타일 반입(start/end/corner) — 레이어 명명 규약 정해 확장.
  const def = {
    id: `user-${
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36)
    }`,
    name: opts.name,
    category: opts.category ?? 'other',
    source: 'user',
    tiles: {
      side: {
        paths,
        width,
        height,
      },
    },
    scale: 1,
    spacing: 0,
    flipAlong: false,
    flipAcross: false,
    fit: 'approximate',
    colorization: 'none',
    stroke: '#000000',
    stroke_width: 1,
    fill: 'none',
  };

  // 스키마 검증 후 반환 (타입/좌표 안전 보장).
  return BrushDefinitionSchema.parse(def);
}
