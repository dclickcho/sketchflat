// 패턴 브러쉬 동적 렌더 엔진 (순수 함수, React/Konva 비의존).
//
// 입력: 브러쉬 정의 + 실효 파라미터 + 패스의 호 길이 테이블(path-로컬 좌표).
// 출력: "제자리에 놓인 타일" 목록 — 각 타일은 원본 path d 문자열 + 배치 변환(Konva 호환:
//        x/y/rotation(deg)/scaleX/scaleY/offset). 캔버스는 이 변환을 그대로 Konva 노드에 적용하고,
//        파트 자신의 transform 아래에 그룹으로 렌더한다(타일은 path-로컬에서 계산되므로).
//
// 타일 좌표 규약(brushes.ts 와 동일): 타일은 수평 author. +x = 패스 진행, y=0 = 패스가 지나는 baseline.

import {
  type ArcTable,
  type BrushDefinition,
  type BrushTile,
  type ResolvedBrushParams,
  pointAtDistance,
} from '@sketchflat/svg-schema';

// 한 장의 배치된 타일. 변환은 Konva 노드 속성과 1:1 (rotation 은 degree).
export interface PlacedTile {
  paths: string[]; // 타일-로컬 원본 path d.
  x: number;
  y: number;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
  offsetX: number; // 타일-로컬 회전/스케일 기준점 (= width/2 → 타일 중심을 패스 점에 정렬).
  offsetY: number;
}

export interface BrushRenderResult {
  tiles: PlacedTile[];
  stroke: string;
  strokeWidth: number;
  fill: string;
}

const EMPTY: BrushRenderResult = { tiles: [], stroke: 'none', strokeWidth: 0, fill: 'none' };

// 단일 sub-path(ArcTable) 에 브러쉬를 깔아 타일 목록을 만든다.
export function renderBrushAlong(
  def: BrushDefinition,
  params: ResolvedBrushParams,
  table: ArcTable,
): BrushRenderResult {
  const total = table.total;
  if (total < 1e-6) return EMPTY;

  const side = def.tiles.side;
  const start = def.tiles.start;
  const end = def.tiles.end;

  const sideW = side.width * params.scale;
  if (sideW < 1e-6) return EMPTY;

  // 시작/끝 캡이 차지하는 길이(자연 스케일). 캡은 늘이지 않는다.
  const startW = start ? start.width * params.scale : 0;
  const endW = end ? end.width * params.scale : 0;
  const middleLen = Math.max(0, total - startW - endW);

  const tiles: PlacedTile[] = [];

  // 시작 캡 — [0, startW] 중앙에 자연 크기로.
  if (start && startW > 1e-6) {
    tiles.push(placeTile(start, params, table, startW / 2, params.scale, params.scale));
  }

  // 본체 — fit 모드에 따라 반복 수/스텝/늘임 결정.
  if (middleLen > 1e-6) {
    const sx0 = params.scale * (params.flipAlong ? -1 : 1);
    const sy = params.scale * (params.flipAcross ? -1 : 1);

    if (params.fit === 'space') {
      // 타일 자연 크기 유지, 슬롯을 키워 사이에 여백. spacing = width 대비 추가 비율.
      const slot = sideW * (1 + Math.max(0, params.spacing));
      const n = Math.max(1, Math.floor(middleLen / slot));
      const step = middleLen / n; // 남는 길이를 균등 분배해 양끝 여백까지 자연스럽게.
      for (let i = 0; i < n; i++) {
        const center = startW + (i + 0.5) * step;
        tiles.push(placeTile(side, params, table, center, sx0, sy));
      }
    } else {
      // stretch / approximate — 정수 개수로 채우고 본체 타일을 패스 방향으로 늘인다.
      const n = Math.max(1, Math.round(middleLen / sideW));
      const actualW = middleLen / n; // 실제 한 타일이 차지할 길이.
      const stretch = actualW / sideW; // 패스 방향 추가 스케일 배수.
      const sx = sx0 * (params.fit === 'stretch' ? stretch : 1);
      // approximate 는 타일 자연 크기 유지(stretch=1) → 미세한 누적 오차는 무시(근사).
      for (let i = 0; i < n; i++) {
        const center = startW + (i + 0.5) * actualW;
        tiles.push(placeTile(side, params, table, center, sx, sy));
      }
    }
  }

  // 끝 캡 — [total-endW, total] 중앙.
  if (end && endW > 1e-6) {
    tiles.push(placeTile(end, params, table, total - endW / 2, params.scale, params.scale));
  }

  return {
    tiles,
    stroke: params.stroke,
    strokeWidth: params.stroke_width,
    fill: params.fill,
  };
}

// 여러 sub-path 각각에 브러쉬를 깐 결과를 합친다.
export function renderBrush(
  def: BrushDefinition,
  params: ResolvedBrushParams,
  tables: ArcTable[],
): BrushRenderResult {
  const all: PlacedTile[] = [];
  for (const t of tables) {
    all.push(...renderBrushAlong(def, params, t).tiles);
  }
  return {
    tiles: all,
    stroke: params.stroke,
    strokeWidth: params.stroke_width,
    fill: params.fill,
  };
}

// 거리 centerDist 에 타일 중심을 놓는다. 타일 중심(width/2)을 패스 점에 맞추고 접선각으로 회전.
function placeTile(
  tile: BrushTile,
  _params: ResolvedBrushParams,
  table: ArcTable,
  centerDist: number,
  scaleX: number,
  scaleY: number,
): PlacedTile {
  const s = pointAtDistance(table, centerDist);
  return {
    paths: tile.paths,
    x: s.x,
    y: s.y,
    rotationDeg: (s.angle * 180) / Math.PI,
    scaleX,
    scaleY,
    offsetX: tile.width / 2,
    offsetY: 0,
  };
}

// 배치된 타일의 2x3 affine 행렬 [a, b, c, d, e, f].
// Konva 변환 순서(translate∘rotate∘scale∘translate(-offset))와 동치 — Expand 베이킹에서 사용.
//   x' = a*px + c*py + e,  y' = b*px + d*py + f
export function tileAffine(t: PlacedTile): [number, number, number, number, number, number] {
  const rot = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const a = cos * t.scaleX;
  const b = sin * t.scaleX;
  const c = -sin * t.scaleY;
  const d = cos * t.scaleY;
  const e = t.x - a * t.offsetX - c * t.offsetY;
  const f = t.y - b * t.offsetX - d * t.offsetY;
  return [a, b, c, d, e, f];
}
