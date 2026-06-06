// 브러쉬 id → 정의 해석. 프리셋(모듈 상수)을 먼저 보고, 없으면 스케치에 저장된 사용자
// 브러쉬에서 찾는다. 캔버스 렌더와 Expand 가 공유하는 단일 진입점.

import {
  resolveBrushParams,
  type BrushDefinition,
  type Part,
  type ResolvedBrushParams,
  type Sketch,
} from '@sketchflat/svg-schema';
import { getPresetBrush, BRUSH_PRESETS } from './brush-presets';

export function findBrushDefinition(
  brushId: string,
  sketch: Sketch | null,
): BrushDefinition | undefined {
  return (
    getPresetBrush(brushId) ??
    sketch?.brush_definitions.find((b) => b.id === brushId)
  );
}

// UI 그리드용 — 프리셋 + 사용자 브러쉬 전체 목록(프리셋 먼저).
export function allBrushes(sketch: Sketch | null): BrushDefinition[] {
  return [...BRUSH_PRESETS, ...(sketch?.brush_definitions ?? [])];
}

// 파트에 적용된 브러쉬의 실효 파라미터 — 단, 크기(scale)는 외곽선 '굵기'(part.stroke_width)에
// 맞춘다. 타일 자연 높이(법선 방향) 가 stroke_width 와 같아지도록 scale = stroke_width / tile.height.
// → 캔버스 두께 = scale × tile.height × transform scale = stroke_width × transform scale = 표시 굵기.
// stroke_width 가 0 이하이면(외곽선 없음 등) 정의/오버라이드 기본 scale 로 폴백한다.
// 캔버스 렌더(brush-layer)와 Expand(expand-brush)가 공유하는 단일 진입점이라 둘이 항상 일치한다.
export function resolveBrushParamsForPart(
  def: BrushDefinition,
  part: Part,
): ResolvedBrushParams {
  const base = resolveBrushParams(def, part.brush);
  const tileH = def.tiles.side.height || 1;
  const sw = part.stroke_width;
  if (Number.isFinite(sw) && sw > 0) {
    return { ...base, scale: sw / tileH };
  }
  return base;
}
