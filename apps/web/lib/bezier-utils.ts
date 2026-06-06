// 펜툴/세그먼트 편집에 쓰이는 베지어 수학 헬퍼.
// 모두 path-로컬 좌표(앵커.x/y와 같은 좌표계)를 가정 — 호출자가 stage 좌표를
// 미리 변환해 넘겨준다.

export interface Pt {
  x: number;
  y: number;
}

// (1-t)P + tQ.
export function lerp(P: Pt, Q: Pt, t: number): Pt {
  return { x: P.x + (Q.x - P.x) * t, y: P.y + (Q.y - P.y) * t };
}

// 큐빅 베지어 점 평가. 표준 식 (1-t)³P0 + 3(1-t)²t·H1 + 3(1-t)t²·H2 + t³P1.
export function cubicAt(t: number, P0: Pt, H1: Pt, H2: Pt, P1: Pt): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * P0.x + b * H1.x + c * H2.x + d * P1.x,
    y: a * P0.y + b * H1.y + c * H2.y + d * P1.y,
  };
}

// De Casteljau로 큐빅을 t에서 분할한 결과:
// 좌측 큐빅 [P0, Q0, R0, S], 우측 큐빅 [S, R1, Q2, P1]. S가 분할 지점.
export function splitCubicAtT(
  P0: Pt,
  H1: Pt,
  H2: Pt,
  P1: Pt,
  t: number,
): { Q0: Pt; R0: Pt; S: Pt; R1: Pt; Q2: Pt } {
  const Q0 = lerp(P0, H1, t);
  const Q1 = lerp(H1, H2, t);
  const Q2 = lerp(H2, P1, t);
  const R0 = lerp(Q0, Q1, t);
  const R1 = lerp(Q1, Q2, t);
  const S = lerp(R0, R1, t);
  return { Q0, R0, S, R1, Q2 };
}

// 큐빅 위에서 p와 가장 가까운 점의 t. 균일 샘플 + 국소 정밀화.
// 50샘플 → 1/50=0.02 해상도로 굵게 찾고, 최선 구간 ±0.02 안에서 다시 100샘플로 정밀.
export function closestTOnCubic(
  p: Pt,
  P0: Pt,
  H1: Pt,
  H2: Pt,
  P1: Pt,
  samples = 50,
): number {
  let bestT = 0;
  let bestD2 = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pt = cubicAt(t, P0, H1, H2, P1);
    const d2 = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestT = t;
    }
  }
  const range = 1 / samples;
  const refine = 100;
  for (let i = -refine; i <= refine; i++) {
    const t = Math.max(0, Math.min(1, bestT + (i / refine) * range));
    const pt = cubicAt(t, P0, H1, H2, P1);
    const d2 = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestT = t;
    }
  }
  return bestT;
}

// 직선 [P0, P1] 위에 p를 정사영했을 때의 t (0..1로 클램핑).
export function closestTOnLine(p: Pt, P0: Pt, P1: Pt): number {
  const dx = P1.x - P0.x;
  const dy = P1.y - P0.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return 0;
  const t = ((p.x - P0.x) * dx + (p.y - P0.y) * dy) / len2;
  return Math.max(0, Math.min(1, t));
}

// 큐빅(또는 직선) 한 세그먼트에 대해 클릭 점의 t/거리 동시 반환.
// handle이 양쪽 다 없으면 직선 분기.
export function projectOntoSegment(
  p: Pt,
  a0: Pt,
  a1: Pt,
  handle_out_of_a0?: Pt,
  handle_in_of_a1?: Pt,
): { t: number; dist: number; isLine: boolean } {
  if (handle_out_of_a0 || handle_in_of_a1) {
    const h1 = handle_out_of_a0 ?? a0;
    const h2 = handle_in_of_a1 ?? a1;
    const t = closestTOnCubic(p, a0, h1, h2, a1);
    const pt = cubicAt(t, a0, h1, h2, a1);
    const dist = Math.hypot(pt.x - p.x, pt.y - p.y);
    return { t, dist, isLine: false };
  }
  const t = closestTOnLine(p, a0, a1);
  const x = a0.x + (a1.x - a0.x) * t;
  const y = a0.y + (a1.y - a0.y) * t;
  return { t, dist: Math.hypot(x - p.x, y - p.y), isLine: true };
}
