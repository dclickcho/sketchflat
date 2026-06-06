// 패턴 브러쉬 Expand — 동적으로 렌더되던 타일들을 실제 편집 가능한 Part[] 로 굽는다.
//
// 베이킹 전략: 각 타일의 affine(tileAffine) 을 path-로컬 좌표에 직접 적용한다. arc(A)·smooth(S/T)
// 등 모든 SVG 커맨드를 안전하게 변환하기 위해 이미 의존성으로 들어와 있는 paper.js 를 쓴다
// (paper 는 변환 후 cubic 기반 pathData 를 내보내므로 parsePathD 로 다시 anchors 복원 가능).
// 새 파트의 transform 은 원본 part.transform 을 그대로 물려받아 BrushLayer 렌더와 좌표가 일치한다.

import paper from 'paper/dist/paper-core';
import {
  type Part,
  type Sketch,
  type Anchor,
  DEFAULT_TRANSFORM,
  parsePathD,
  buildPartArcTables,
} from '@sketchflat/svg-schema';
import { renderBrush, tileAffine } from './brush-render';
import { findBrushDefinition, resolveBrushParamsForPart } from './brush-lookup';

let _scopeReady = false;
function ensureScope(): void {
  if (_scopeReady) return;
  paper.setup(new paper.Size(1, 1));
  _scopeReady = true;
}

export interface ExpandResult {
  parts: Part[];
  brushName: string;
}

// part.brush 를 굽는다. id/z_index/group_id 는 호출자(스토어)가 최종 할당하므로 임시값.
export function expandBrushPart(part: Part, sketch: Sketch | null): ExpandResult | null {
  if (!part.brush) return null;
  const def = findBrushDefinition(part.brush.brush_id, sketch);
  if (!def) return null;

  ensureScope();
  const params = resolveBrushParamsForPart(def, part);
  const tables = buildPartArcTables(part);
  const render = renderBrush(def, params, tables);
  if (render.tiles.length === 0) return null;

  const baseT = part.transform ?? DEFAULT_TRANSFORM;
  const out: Part[] = [];

  render.tiles.forEach((tile, ti) => {
    const m = tileAffine(tile);
    const matrix = new paper.Matrix(m[0], m[1], m[2], m[3], m[4], m[5]);

    const bakedDs: string[] = [];
    for (const d of tile.paths) {
      let item: paper.PathItem | null = null;
      try {
        item = new paper.CompoundPath({ pathData: d, insert: false });
      } catch {
        continue;
      }
      item.transform(matrix);
      const pd = item.pathData;
      item.remove();
      if (pd && pd.length > 0) bakedDs.push(pd);
    }
    if (bakedDs.length === 0) return;

    const combined = bakedDs.join(' ');
    const parsed = parsePathD(combined, `tile_${ti}`);
    if (parsed.anchors.length === 0) return;

    out.push({
      id: `tile_${ti}`, // 스토어가 교체.
      category: part.category,
      svg_paths: [combined],
      fill: render.fill,
      stroke: render.stroke,
      stroke_width: render.strokeWidth,
      anchors: parsed.anchors,
      subpath_breaks: parsed.subpath_breaks,
      subpath_closed: parsed.subpath_closed,
      bounding_box: bboxOfAnchors(parsed.anchors),
      z_index: 0, // 스토어가 할당.
      editable: true,
      swappable: true,
      transform: { ...baseT },
      metadata: { brush_origin: def.id },
    });
  });

  if (out.length === 0) return null;
  return { parts: out, brushName: def.name };
}

function bboxOfAnchors(anchors: Anchor[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const consider = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const a of anchors) {
    consider(a.x, a.y);
    if (a.handle_in) consider(a.handle_in.x, a.handle_in.y);
    if (a.handle_out) consider(a.handle_out.x, a.handle_out.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
