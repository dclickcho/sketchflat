// Phase A — 논문 그림 9(a)/(b)/(c) 규칙. 구조선 (classify 가 'structural' 로 분류한 것) 만
// 입력으로 받는다. *원본 anchor 는 절대 만지지 않으며*, 두 가지 부산물만 돌려준다:
//
//  1. mergeRadius — 평면그래프 vertex 스냅에 쓸 임계 (= MIN_LENGTH). face-decompose 가
//     spatial hash 로 사용한다.
//  2. bridges — 9(b)/9(c) 가 만들어낸 가상 직선 결합 후보. face 윤곽이 이 bridge 를 거쳐갈
//     때만 윤곽에 직선 segment 2 개를 *추가* 표시한다 (큐빅 핸들 무시).
//
// 9(a) ① 두 점 거리 < MIN_LENGTH 병합 → 그래프 vertex 스냅에 흡수.
// 9(a) ② deflection < MIN_ANGLE 점은 redundant → 평탄화 폴리라인이 이미 거의 직선이므로
//        토폴로지 식별에 영향 없음. (생략)
// 9(a) ③ 2점 짜리 짧은 선분 (총길이 < MIN_LENGTH) → 잡티. 폐기 sub-path 로 마킹.
// 9(b)   open 끝점 반경 BRIDGE_RADIUS 안에 *다른 구조선* 의 점이 있으면 bridge.
// 9(c)   9(b) 매치 안 된 끝점은 자기 진행방향 ± EXT_ANGLE 콘 안의 가까운 다른 끝점으로 bridge.

import type { Part } from '../parts';
import type { FlatPoint, FlatSubpath } from './flatten';

export interface PhaseAOptions {
  /** 9(a)① 병합 거리 임계 (px). 기본 0.5 */
  minLength?: number;
  /** 9(b) 끝점-선 결합 반경 (px). 기본 1.5 */
  bridgeRadius?: number;
  /** 9(c) 끝점 연장 콘 반각 (rad). 기본 45° */
  extAngle?: number;
  /** 9(c) 콘 안 끝점 탐색 최대 거리 (px). 기본 BRIDGE_RADIUS × 4 */
  extMaxDistance?: number;
}

const DEFAULTS: Required<PhaseAOptions> = {
  minLength: 0.5,
  bridgeRadius: 1.5,
  extAngle: (45 * Math.PI) / 180,
  extMaxDistance: 6,
};

export interface FlatPointRef {
  partId: string;
  anchorIndex: number;
  x: number;
  y: number;
}

export interface BridgeSegment {
  from: FlatPointRef;
  to: FlatPointRef;
  source: '9b' | '9c';
}

export interface DiscardedSubpath {
  partId: string;
  subpathIndex: number;
}

export interface PhaseAResult {
  bridges: BridgeSegment[];
  discardedSubpaths: DiscardedSubpath[];
  mergeRadius: number;
}

export interface PartFlat {
  part: Part;
  subpaths: FlatSubpath[];
}

export function applyPhaseA(structural: PartFlat[], opts: PhaseAOptions = {}): PhaseAResult {
  const o = { ...DEFAULTS, ...opts };

  // 9(a)③ — 너무 짧은 sub-path 폐기.
  const discardedSubpaths: DiscardedSubpath[] = [];
  for (const { part, subpaths } of structural) {
    for (let s = 0; s < subpaths.length; s++) {
      if (polylineLen(subpaths[s]!.points) < o.minLength) {
        discardedSubpaths.push({ partId: part.id, subpathIndex: s });
      }
    }
  }
  const isDiscarded = (partId: string, sIdx: number) =>
    discardedSubpaths.some((d) => d.partId === partId && d.subpathIndex === sIdx);

  // 9(b)/9(c) 입력 — open sub-path 의 양 끝점.
  const endpoints: Endpoint[] = [];
  for (const { part, subpaths } of structural) {
    for (let s = 0; s < subpaths.length; s++) {
      if (isDiscarded(part.id, s)) continue;
      const sp = subpaths[s]!;
      if (sp.closed) continue; // 닫힌 sub-path 는 끝점이 없음.
      if (sp.points.length < 2) continue;
      // 시작 끝점 — 진행방향은 [0]→[1] 의 *반대* (path 바깥으로 향함).
      endpoints.push(makeEndpoint(part.id, s, sp.points, /*atStart*/ true));
      // 종료 끝점.
      endpoints.push(makeEndpoint(part.id, s, sp.points, /*atStart*/ false));
    }
  }

  // 9(b) — 끝점 반경 BRIDGE_RADIUS 안에 다른 구조선의 점이 있는지.
  // 다른 구조선 = 다른 sub-path (자기 sub-path 의 다른 끝점은 9(c) 영역).
  const bridges: BridgeSegment[] = [];
  const matched = new Set<number>(); // endpoint index → 이미 9(b) 에서 매치된 것

  // 모든 후보 점 (구조선 모든 sub-path 의 모든 평탄화 점) 을 spatial hash 에 넣는다.
  // hash 셀 크기 = bridgeRadius — 인접 9개 셀만 보면 됨.
  const cellSize = o.bridgeRadius;
  const grid = new Map<string, Array<{ partId: string; subpathIndex: number; point: FlatPoint }>>();
  for (const { part, subpaths } of structural) {
    for (let s = 0; s < subpaths.length; s++) {
      if (isDiscarded(part.id, s)) continue;
      for (const point of subpaths[s]!.points) {
        const key = cellKey(point.x, point.y, cellSize);
        let bucket = grid.get(key);
        if (!bucket) {
          bucket = [];
          grid.set(key, bucket);
        }
        bucket.push({ partId: part.id, subpathIndex: s, point });
      }
    }
  }

  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i]!;
    let best: { d2: number; partId: string; anchorIndex: number; x: number; y: number } | null = null;
    for (const cand of nearbyCells(grid, ep.x, ep.y, cellSize)) {
      // 자기 sub-path 의 점은 제외 (자기 자신 또는 같은 라인).
      if (cand.partId === ep.partId && cand.subpathIndex === ep.subpathIndex) continue;
      const dx = cand.point.x - ep.x;
      const dy = cand.point.y - ep.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > o.bridgeRadius * o.bridgeRadius) continue;
      if (!best || d2 < best.d2) {
        best = {
          d2,
          partId: cand.point.partId,
          anchorIndex: cand.point.anchorIndex,
          x: cand.point.x,
          y: cand.point.y,
        };
      }
    }
    if (best) {
      bridges.push({
        from: { partId: ep.partId, anchorIndex: ep.anchorIndex, x: ep.x, y: ep.y },
        to: { partId: best.partId, anchorIndex: best.anchorIndex, x: best.x, y: best.y },
        source: '9b',
      });
      matched.add(i);
    }
  }

  // 9(c) — 매치 안 된 끝점끼리, 진행방향 콘 안에서 가까운 한 쌍 결합.
  // 한 쌍은 양쪽 모두 "콘 안" 조건을 만족해야 한다 (비대칭 결합 방지).
  const cosExt = Math.cos(o.extAngle);
  for (let i = 0; i < endpoints.length; i++) {
    if (matched.has(i)) continue;
    const a = endpoints[i]!;
    let best: { j: number; d2: number } | null = null;
    for (let j = i + 1; j < endpoints.length; j++) {
      if (matched.has(j)) continue;
      const b = endpoints[j]!;
      // 자기 자신의 다른 끝 (같은 sub-path) 도 후보로 둔다 — 거의 닫힌 사각형의
      // 한 코너가 빠진 경우.
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1e-12) continue; // 같은 점.
      if (d2 > o.extMaxDistance * o.extMaxDistance) continue;
      const dist = Math.sqrt(d2);
      // a 의 방향벡터로 본 b 방향 cos. cos > cosExt 이면 콘 안.
      const cosA = (a.dx * dx + a.dy * dy) / dist;
      const cosB = (b.dx * -dx + b.dy * -dy) / dist;
      if (cosA < cosExt || cosB < cosExt) continue;
      if (!best || d2 < best.d2) best = { j, d2 };
    }
    if (best) {
      const b = endpoints[best.j]!;
      bridges.push({
        from: { partId: a.partId, anchorIndex: a.anchorIndex, x: a.x, y: a.y },
        to: { partId: b.partId, anchorIndex: b.anchorIndex, x: b.x, y: b.y },
        source: '9c',
      });
      matched.add(i);
      matched.add(best.j);
    }
  }

  // 9(b) 가 끝점 A 의 매치로 끝점 B 의 위치를 잡았다면 B 도 동일 bridge 를 만들어 중복이
  // 발생한다 (또는 9(c) 에서 i,j 와 j,i 도). 평면그래프에 동일 vertex pair 의 parallel edge
  // 가 들어가면 face traversal 이 무너지므로 같은 (partId, anchorIndex) 쌍으로 dedup.
  const dedupedBridges: BridgeSegment[] = [];
  const seen = new Set<string>();
  for (const bridge of bridges) {
    const a = `${bridge.from.partId}#${bridge.from.anchorIndex}`;
    const b = `${bridge.to.partId}#${bridge.to.anchorIndex}`;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedBridges.push(bridge);
  }

  return {
    bridges: dedupedBridges,
    discardedSubpaths,
    mergeRadius: o.minLength,
  };
}

interface Endpoint {
  partId: string;
  subpathIndex: number;
  /** 끝점이 가리키는 *원본 anchor* 인덱스. */
  anchorIndex: number;
  x: number;
  y: number;
  /** path 바깥으로 향하는 방향 단위벡터. */
  dx: number;
  dy: number;
}

function makeEndpoint(
  partId: string,
  subpathIndex: number,
  points: FlatPoint[],
  atStart: boolean,
): Endpoint {
  if (atStart) {
    const p = points[0]!;
    // 진행방향 = p → next 의 *반대*
    const next = points[1]!;
    const v = unitVec(p.x - next.x, p.y - next.y);
    return {
      partId,
      subpathIndex,
      anchorIndex: p.anchorIndex,
      x: p.x,
      y: p.y,
      dx: v.x,
      dy: v.y,
    };
  } else {
    const p = points[points.length - 1]!;
    const prev = points[points.length - 2]!;
    const v = unitVec(p.x - prev.x, p.y - prev.y);
    return {
      partId,
      subpathIndex,
      anchorIndex: p.anchorIndex,
      x: p.x,
      y: p.y,
      dx: v.x,
      dy: v.y,
    };
  }
}

function unitVec(x: number, y: number): { x: number; y: number } {
  const len = Math.sqrt(x * x + y * y);
  if (len < 1e-12) return { x: 1, y: 0 };
  return { x: x / len, y: y / len };
}

function polylineLen(points: FlatPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

function cellKey(x: number, y: number, size: number): string {
  return `${Math.floor(x / size)},${Math.floor(y / size)}`;
}

function* nearbyCells<T>(
  grid: Map<string, T[]>,
  x: number,
  y: number,
  size: number,
): Generator<T> {
  const cx = Math.floor(x / size);
  const cy = Math.floor(y / size);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get(`${cx + dx},${cy + dy}`);
      if (!bucket) continue;
      for (const item of bucket) yield item;
    }
  }
}
