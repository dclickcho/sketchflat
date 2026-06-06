// 패스의 호 길이(arc-length) 매개화. 패턴 브러쉬가 Side 타일을 패스를 따라 일정 간격으로
// 배치하려면 "패스 시작점에서 거리 s 만큼 떨어진 지점의 좌표와 접선 각도"가 필요하다.
//
// SVG path 의 자연 매개변수 t 는 곡률에 따라 속도가 들쭉날쭉하므로 그대로 쓰면 타일 간격이
// 곡선 구간에서 뭉친다. 그래서 anchors 를 폴리라인으로 평탄화(`flattenPart` 재사용)한 뒤
// 정점별 누적 거리 테이블을 만들고, 거리 → (점, 접선) 을 선형 보간으로 되돌린다.
//
// 좌표계: anchors.x/y 와 동일한 path-로컬 좌표. transform 은 호출자가 별도로 적용한다.

import type { Part } from './parts';
import { flattenPart, type FlattenOptions } from './refinement/flatten';

export interface ArcPoint {
  x: number;
  y: number;
}

export interface ArcTable {
  // 평탄화된 폴리라인 정점.
  points: ArcPoint[];
  // cumulative[i] = points[0] 부터 points[i] 까지의 호 길이. cumulative[0] === 0.
  // 길이는 points 와 동일.
  cumulative: number[];
  // 전체 호 길이 (= cumulative[last]).
  total: number;
  // 닫힌 패스 여부 — 브러쉬 코너 처리/끝맺음에서 사용.
  closed: boolean;
}

export interface PathSample {
  x: number;
  y: number;
  // 접선 방향 (라디안). atan2(dy, dx). Side 타일을 이 각도로 회전시켜 패스에 정렬한다.
  angle: number;
}

// 폴리라인 정점 배열 → 누적 호 길이 테이블. 인접 중복점(길이 0 세그먼트)은 건너뛰어
// 보간 시 0 분모가 생기지 않게 한다.
export function buildArcTable(points: ArcPoint[], closed = false): ArcTable {
  const pts: ArcPoint[] = [];
  const cumulative: number[] = [];
  let acc = 0;
  for (const p of points) {
    if (pts.length === 0) {
      pts.push({ x: p.x, y: p.y });
      cumulative.push(0);
      continue;
    }
    const prev = pts[pts.length - 1]!;
    const seg = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (seg < 1e-9) continue; // 중복점 스킵.
    acc += seg;
    pts.push({ x: p.x, y: p.y });
    cumulative.push(acc);
  }
  return { points: pts, cumulative, total: acc, closed };
}

// Part 의 각 sub-path 를 평탄화해 sub-path 별 ArcTable 을 반환. 브러쉬는 보통 단일
// open 패스에 적용되지만, 여러 sub-path 가 있어도 각각 독립적으로 타일링할 수 있도록 배열.
export function buildPartArcTables(part: Part, opts?: FlattenOptions): ArcTable[] {
  return flattenPart(part, opts).map((sp) => buildArcTable(sp.points, sp.closed));
}

// 호 길이 s (0..total) 위치의 좌표 + 접선 각도. s 는 [0, total] 으로 클램핑된다.
// 빈/단일점 테이블은 angle 0 의 그 점(혹은 원점)을 반환.
export function pointAtDistance(table: ArcTable, s: number): PathSample {
  const { points, cumulative, total } = table;
  if (points.length === 0) return { x: 0, y: 0, angle: 0 };
  if (points.length === 1) return { x: points[0]!.x, y: points[0]!.y, angle: 0 };

  const clamped = Math.max(0, Math.min(total, s));

  // cumulative 에서 clamped 를 포함하는 구간 [i, i+1] 을 이진 탐색.
  // cumulative 는 단조 증가. clamped 이상이 처음 나오는 인덱스 hi 를 찾는다.
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! < clamped) lo = mid + 1;
    else hi = mid;
  }
  // hi 는 cumulative[hi] >= clamped 인 최소 인덱스. 구간은 [hi-1, hi].
  const i1 = hi === 0 ? 1 : hi;
  const i0 = i1 - 1;
  const a = points[i0]!;
  const b = points[i1]!;
  const segLen = cumulative[i1]! - cumulative[i0]!;
  const f = segLen < 1e-9 ? 0 : (clamped - cumulative[i0]!) / segLen;
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}
