// Part → 'structural' | 'decorative' 분류기.
//
// Arrow(QuiverAI) 출력 SVG 는 stroke-width 와 dasharray 로 시맨틱을 거의 구분해 둔 상태다
// (rawsvg.txt 의 .cls-1~.cls-7 룰셋 참조). 이 분류 결과로 Phase A/B 에 들어갈 구조선과
// 장식선을 갈라 — 구조선만 폐곡선 탐색 대상이 된다.
//
// 결정 기준:
//  - 점선 (stroke_dasharray 가 비어있지 않음) → decorative. cls-3 stitch 가 여기 해당.
//  - stroke_width >= 1.0 → structural. cls-1 (1.2px) 류 외곽선.
//  - stroke_width <= 0.3 → decorative. cls-3/4/5/6 미세 디테일.
//  - 0.3 < stroke_width < 1.0 → cls-2 / cls-7 영역. anchor 폴리라인 길이로 선별 —
//    `CLS2_STRUCTURAL_LENGTH` 이상이면 칼라 외곽 같은 구조 보조선으로 간주, 아니면 장식.
//
// 길이는 anchor 좌표 폴리라인의 합. 큐빅 호의 실제 길이보다 약간 짧지만 임계 비교용으로 충분.

import type { Part } from '../parts';

export type RefinementRole = 'structural' | 'decorative';

export interface ClassifyOptions {
  /** stroke-width 가 이 임계 이상이면 무조건 structural. 기본 1.0 */
  thickStructuralWidth?: number;
  /** stroke-width 가 이 임계 이하이면 무조건 decorative. 기본 0.3 */
  thinDecorativeWidth?: number;
  /** 중간 두께 (cls-2 류) 가 이 길이 이상이면 structural. 기본 30px */
  cls2StructuralLength?: number;
}

const DEFAULTS: Required<ClassifyOptions> = {
  thickStructuralWidth: 1.0,
  thinDecorativeWidth: 0.3,
  cls2StructuralLength: 30,
};

export function classifyPart(part: Part, opts: ClassifyOptions = {}): RefinementRole {
  const o = { ...DEFAULTS, ...opts };

  // 점선은 시맨틱상 항상 장식 (stitch / dotted detail).
  if (part.stroke_dasharray && part.stroke_dasharray.length > 0) return 'decorative';

  const w = part.stroke_width;
  if (w >= o.thickStructuralWidth) return 'structural';
  if (w <= o.thinDecorativeWidth) return 'decorative';

  // 중간 두께 — 길이 기준.
  const length = polylineLength(part);
  return length >= o.cls2StructuralLength ? 'structural' : 'decorative';
}

export function classifyParts(
  parts: Part[],
  opts: ClassifyOptions = {},
): Map<string, RefinementRole> {
  const out = new Map<string, RefinementRole>();
  for (const p of parts) out.set(p.id, classifyPart(p, opts));
  return out;
}

// anchor 좌표를 잇는 폴리라인의 총 길이. subpath_breaks 를 존중해 sub-path 경계는 건너뛴다.
function polylineLength(part: Part): number {
  const anchors = part.anchors;
  if (anchors.length < 2) return 0;
  const breaks = new Set(part.subpath_breaks ?? []);
  let total = 0;
  for (let i = 1; i < anchors.length; i++) {
    if (breaks.has(i)) continue; // 새 sub-path 시작 — 점프이므로 거리 합산 X.
    const a = anchors[i - 1]!;
    const b = anchors[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}
