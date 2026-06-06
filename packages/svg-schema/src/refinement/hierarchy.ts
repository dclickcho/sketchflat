// Phase C — Point-in-Polygon 계층화.
//
// Phase B 가 만든 face 를 부모, 장식선 (classify='decorative') 을 자식으로 묶는다. 두 가지
// 조건을 *모두* 만족해야 자식 후보:
//   (1) 장식 part 의 anchor 다수결 (>= 절반) 이 face 폴리곤 내부 (또는 버퍼 안)
//   (2) 장식 part 의 bbox 가 face bbox 에 PIP_BBOX_OVERLAP (기본 0.8) 이상 포함
// 후보 face 들 중 area 가 가장 작은 face 가 부모. 후보 없으면 root.
//
// face 폴리곤 외부 버퍼는 stroke-width/2 만큼 — 헴/트림 스티치 경계 케이스 흡수. 구현은
// "polygon 의 모서리에서 buffer 거리 안에 있으면 내부로 간주" 식의 정확한 오프셋이 아니라
// PiP 판정 시 buffer-dilated 검사로 처리.

import type { Face, Part } from '../parts';

export interface HierarchyOptions {
  /** part bbox 가 face bbox 에 이 비율 이상 포함되어야 자식 후보. 기본 0.8 */
  pipBboxOverlap?: number;
  /** face 외부 버퍼 = stroke_width × 이 값. 기본 0.5 */
  bufferScale?: number;
}

const DEFAULTS: Required<HierarchyOptions> = {
  // 0 = bbox 사전 필터 비활성화. 모든 face 가 후보가 되고, PiP + 버퍼만으로 결정.
  // 헴/소매단 스티치 (face 경계선 *위* 의 얇은 가로 박스) 는 bbox 가 face bbox 와 사실상
  // 0% 만 겹쳐 어떤 비율 임계도 통과 못 함 — 검사 자체를 끈다. faces=5 × parts=195 정도로
  // PiP 비용 부담 미미.
  pipBboxOverlap: 0,
  // anchor 가 face 경계 위에 살짝 걸친 점들을 흡수하기 위한 외곽 버퍼 (= stroke_width × 1.0).
  bufferScale: 1.0,
};

export interface HierarchyResult {
  /** part_id → parent face id (없으면 undefined). */
  parentByPart: Map<string, string | undefined>;
  /** root fallback 이 된 장식 part 수 — 모니터링용. */
  orphanCount: number;
}

export function buildHierarchy(
  decorativeParts: Part[],
  faces: Face[],
  structuralParts: Part[],
  opts: HierarchyOptions = {},
): HierarchyResult {
  const o = { ...DEFAULTS, ...opts };

  // face id → 평균 stroke-width 기반 buffer. face 는 자기를 만든 구조선의 두께를 직접
  // 들고 있지 않으므로, 구조선 평균값을 face 별로 동일하게 적용 (충분한 근사).
  const avgStructuralWidth =
    structuralParts.length > 0
      ? structuralParts.reduce((sum, p) => sum + p.stroke_width, 0) / structuralParts.length
      : 1.0;
  const buffer = avgStructuralWidth * o.bufferScale;

  // face area 미리 계산 (bbox area 로 근사 — flat_polygon 셰이스 절대값이 더 정확하지만
  // bounding_box 는 이미 들고 있음). 가장 작은 face 선택용.
  const faceAreas = new Map<string, number>();
  for (const f of faces) {
    faceAreas.set(f.id, f.bounding_box.width * f.bounding_box.height);
  }

  const parentByPart = new Map<string, string | undefined>();
  let orphanCount = 0;

  for (const part of decorativeParts) {
    const partBbox = computePartBbox(part);
    const candidates: string[] = [];

    for (const face of faces) {
      // (2) bbox 포함률 빠르게 거름.
      if (bboxOverlapRatio(partBbox, face.bounding_box) < o.pipBboxOverlap) continue;
      // (1) anchor 다수결 PiP.
      if (!majorityAnchorsInside(part, face, buffer)) continue;
      candidates.push(face.id);
    }

    if (candidates.length === 0) {
      parentByPart.set(part.id, undefined);
      orphanCount += 1;
      continue;
    }

    // 가장 작은 face 선택.
    let bestId = candidates[0]!;
    let bestArea = faceAreas.get(bestId) ?? Infinity;
    for (let i = 1; i < candidates.length; i++) {
      const id = candidates[i]!;
      const a = faceAreas.get(id) ?? Infinity;
      if (a < bestArea) {
        bestId = id;
        bestArea = a;
      }
    }
    parentByPart.set(part.id, bestId);
  }

  return { parentByPart, orphanCount };
}

function computePartBbox(part: Part): { x: number; y: number; width: number; height: number } {
  if (part.anchors.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const a of part.anchors) {
    if (a.x < minX) minX = a.x;
    if (a.y < minY) minY = a.y;
    if (a.x > maxX) maxX = a.x;
    if (a.y > maxY) maxY = a.y;
    // 핸들도 포함시켜 bbox 가 큐빅 호 범위를 어느 정도 반영.
    for (const h of [a.handle_in, a.handle_out]) {
      if (!h) continue;
      if (h.x < minX) minX = h.x;
      if (h.y < minY) minY = h.y;
      if (h.x > maxX) maxX = h.x;
      if (h.y > maxY) maxY = h.y;
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function bboxOverlapRatio(
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
): number {
  const ix0 = Math.max(inner.x, outer.x);
  const iy0 = Math.max(inner.y, outer.y);
  const ix1 = Math.min(inner.x + inner.width, outer.x + outer.width);
  const iy1 = Math.min(inner.y + inner.height, outer.y + outer.height);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const innerArea = inner.width * inner.height;
  if (innerArea < 1e-9) {
    // 영역 0 인 part (예: 점 하나) 는 face bbox 안에만 들어 있으면 OK.
    return iw === 0 && ih === 0 && ix0 >= outer.x && iy0 >= outer.y ? 1 : 0;
  }
  return (iw * ih) / innerArea;
}

function majorityAnchorsInside(part: Part, face: Face, buffer: number): boolean {
  if (part.anchors.length === 0) return false;
  let inside = 0;
  for (const a of part.anchors) {
    if (pointInPolygonBuffered(a.x, a.y, face.flat_polygon, buffer)) inside += 1;
  }
  return inside * 2 >= part.anchors.length;
}

// ray-casting + buffer (= 폴리곤 모서리 distance < buffer 면 내부 처리).
function pointInPolygonBuffered(
  px: number,
  py: number,
  poly: ReadonlyArray<{ x: number; y: number }>,
  buffer: number,
): boolean {
  if (poly.length < 3) return false;
  // 1) 표준 PiP.
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  if (inside) return true;
  if (buffer <= 0) return false;
  // 2) 모서리 거리 < buffer.
  const b2 = buffer * buffer;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d2 = pointSegmentDistSq(px, py, poly[j]!.x, poly[j]!.y, poly[i]!.x, poly[i]!.y);
    if (d2 <= b2) return true;
  }
  return false;
}

function pointSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) {
    const ddx = px - ax;
    const ddy = py - ay;
    return ddx * ddx + ddy * ddy;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ddx = px - cx;
  const ddy = py - cy;
  return ddx * ddx + ddy * ddy;
}
