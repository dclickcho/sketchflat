// Anchor[] (cubic) → 평탄화된 FlatPoint[].
//
// Phase B (face-decompose) 가 토폴로지를 식별하기 위한 임시 스캐폴드. 평탄화는 *식별용*
// 이지 출력용이 아니므로 원본 큐빅 anchor 는 한 번도 만지지 않는다. 평탄화 결과는 face
// 윤곽 + bbox + PiP 계산에만 쓰인다.
//
// 알고리즘: 적응형 De Casteljau. 각 큐빅 세그먼트 (start, handle_out, handle_in, end) 를
// 컨트롤 포인트의 직선 편차가 `epsilon` 이하가 될 때까지 재귀 분할.
//
// 각 FlatPoint 는 출처를 남긴다 — partId + anchorIndex + isAnchor. face-decompose 가
// 이 메타로 face 윤곽을 다시 *원본 anchor reference 시퀀스* 로 환원한다.

import type { Anchor } from '../anchors';
import type { Part } from '../parts';

export interface FlatPoint {
  x: number;
  y: number;
  partId: string;
  /** 실제 anchor 점이면 그 인덱스. 보간점이면 "직전 anchor 인덱스". */
  anchorIndex: number;
  /** 보간점이 아닌 실제 anchor 점. */
  isAnchor: boolean;
  /** 어느 sub-path 인지 (subpath_breaks 기준 0-base). */
  subpathIndex: number;
}

export interface FlatSubpath {
  points: FlatPoint[];
  closed: boolean;
}

export interface FlattenOptions {
  /** 큐빅 평탄화 정확도 (px). 작을수록 점 많아짐. 기본 0.5 */
  epsilon?: number;
  /** 안전 가드: 한 세그먼트 최대 분할 깊이. 무한루프 방지용. 기본 18 (≒ 26만 분할) */
  maxDepth?: number;
}

const DEFAULT_EPSILON = 0.5;
const DEFAULT_MAX_DEPTH = 18;

export function flattenPart(part: Part, opts: FlattenOptions = {}): FlatSubpath[] {
  const epsilon = opts.epsilon ?? DEFAULT_EPSILON;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const anchors = part.anchors;
  if (anchors.length === 0) return [];

  const breaks = part.subpath_breaks ?? [];
  const closedFlags = part.subpath_closed ?? [];
  const subpathCount = breaks.length + 1;

  // 각 sub-path 의 [start, end) anchor 인덱스 범위 계산.
  const ranges: Array<{ start: number; end: number; closed: boolean }> = [];
  for (let s = 0; s < subpathCount; s++) {
    const start = s === 0 ? 0 : breaks[s - 1]!;
    const end = s === subpathCount - 1 ? anchors.length : breaks[s]!;
    const closed = closedFlags[s] ?? false;
    ranges.push({ start, end, closed });
  }

  const out: FlatSubpath[] = [];
  for (let s = 0; s < ranges.length; s++) {
    const { start, end, closed } = ranges[s]!;
    if (end - start < 1) continue;
    const points: FlatPoint[] = [];
    // 첫 anchor 는 그대로 push.
    const first = anchors[start]!;
    points.push({
      x: first.x,
      y: first.y,
      partId: part.id,
      anchorIndex: start,
      isAnchor: true,
      subpathIndex: s,
    });
    // 인접 anchor 사이를 큐빅으로 평탄화.
    for (let i = start; i < end - 1; i++) {
      flattenCubic(anchors[i]!, anchors[i + 1]!, i, part.id, s, epsilon, maxDepth, points);
    }
    // 닫힌 sub-path 면 마지막 → 첫 anchor 까지의 closing segment 도 평탄화.
    if (closed && end - start >= 2) {
      flattenCubic(anchors[end - 1]!, anchors[start]!, end - 1, part.id, s, epsilon, maxDepth, points);
    }
    out.push({ points, closed });
  }
  return out;
}

// 한 cubic 세그먼트 (a → b) 를 평탄화해 points 에 *누적*. 시작점은 호출자가 이미 push 했고
// 여기서는 끝점과 보간점을 추가한다.
function flattenCubic(
  a: Anchor,
  b: Anchor,
  startIndex: number,
  partId: string,
  subpathIndex: number,
  epsilon: number,
  maxDepth: number,
  out: FlatPoint[],
): void {
  // 두 anchor 가 모두 직선 (handle 부재) 이면 분할 없이 끝점만 push.
  const c1 = a.handle_out ?? { x: a.x, y: a.y };
  const c2 = b.handle_in ?? { x: b.x, y: b.y };
  const isLine =
    a.handle_out === undefined &&
    b.handle_in === undefined;

  if (isLine) {
    out.push({
      x: b.x,
      y: b.y,
      partId,
      anchorIndex: startIndex + 1,
      isAnchor: true,
      subpathIndex,
    });
    return;
  }

  subdivide(
    a.x, a.y,
    c1.x, c1.y,
    c2.x, c2.y,
    b.x, b.y,
    startIndex,
    partId,
    subpathIndex,
    epsilon,
    maxDepth,
    out,
  );
  // 끝점은 anchor 표시로 다시 push (subdivide 는 보간점만 emit).
  // 단, 마지막 보간점이 끝점과 일치하면 isAnchor 를 true 로 갱신.
  const last = out[out.length - 1];
  if (last && Math.abs(last.x - b.x) < 1e-6 && Math.abs(last.y - b.y) < 1e-6) {
    last.isAnchor = true;
    last.anchorIndex = startIndex + 1;
  } else {
    out.push({
      x: b.x,
      y: b.y,
      partId,
      anchorIndex: startIndex + 1,
      isAnchor: true,
      subpathIndex,
    });
  }
}

function subdivide(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  startIndex: number,
  partId: string,
  subpathIndex: number,
  epsilon: number,
  depth: number,
  out: FlatPoint[],
): void {
  if (depth <= 0 || isFlatEnough(x0, y0, x1, y1, x2, y2, x3, y3, epsilon)) {
    // 충분히 평탄 — 끝점을 보간점으로 push (호출자가 시작점은 이미 push).
    out.push({
      x: x3,
      y: y3,
      partId,
      anchorIndex: startIndex,
      isAnchor: false,
      subpathIndex,
    });
    return;
  }
  // De Casteljau 중점 분할.
  const x01 = (x0 + x1) / 2, y01 = (y0 + y1) / 2;
  const x12 = (x1 + x2) / 2, y12 = (y1 + y2) / 2;
  const x23 = (x2 + x3) / 2, y23 = (y2 + y3) / 2;
  const x012 = (x01 + x12) / 2, y012 = (y01 + y12) / 2;
  const x123 = (x12 + x23) / 2, y123 = (y12 + y23) / 2;
  const x0123 = (x012 + x123) / 2, y0123 = (y012 + y123) / 2;

  subdivide(x0, y0, x01, y01, x012, y012, x0123, y0123, startIndex, partId, subpathIndex, epsilon, depth - 1, out);
  subdivide(x0123, y0123, x123, y123, x23, y23, x3, y3, startIndex, partId, subpathIndex, epsilon, depth - 1, out);
}

// 컨트롤 포인트 c1, c2 가 시작-끝 직선 p0-p3 에서 epsilon 이내인지.
// 거리^2 비교로 sqrt 회피. (수직거리 d = |cross(v, c-p0)| / |v|, |v| 곱한 두 변이 비교 가능)
function isFlatEnough(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  epsilon: number,
): boolean {
  const ux = x3 - x0;
  const uy = y3 - y0;
  const lenSq = ux * ux + uy * uy;
  // 시작==끝이면 컨트롤이 같은 점 근처여야 평탄.
  if (lenSq < 1e-12) {
    const d1 = (x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0);
    const d2 = (x2 - x0) * (x2 - x0) + (y2 - y0) * (y2 - y0);
    return d1 < epsilon * epsilon && d2 < epsilon * epsilon;
  }
  // perpendicular distance squared = cross^2 / lenSq.
  const cross1 = (x1 - x0) * uy - (y1 - y0) * ux;
  const cross2 = (x2 - x0) * uy - (y2 - y0) * ux;
  const epsSqLen = epsilon * epsilon * lenSq;
  return cross1 * cross1 <= epsSqLen && cross2 * cross2 <= epsSqLen;
}
