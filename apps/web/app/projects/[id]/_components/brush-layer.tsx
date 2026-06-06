'use client';
// 패턴 브러쉬 동적 렌더 — part.brush 가 설정된 파트의 spine(svg_paths/anchors)을 따라
// 브러쉬 타일을 깔아 Konva 로 그린다. anchors/transform/brush 파라미터가 바뀌면 useMemo 가
// 다시 계산해 "라이브" 로 갱신된다(동적성). Expand 전까지 이 레이어가 시각적 결과를 담당.

import { useMemo } from 'react';
import { Group, Path } from 'react-konva';
import {
  type Part,
  type Sketch,
  DEFAULT_TRANSFORM,
  buildPartArcTables,
} from '@sketchflat/svg-schema';
import { renderBrush } from '@/lib/brush-render';
import { findBrushDefinition, resolveBrushParamsForPart } from '@/lib/brush-lookup';

interface Props {
  part: Part;
  sketch: Sketch | null;
}

export function BrushLayer({ part, sketch }: Props) {
  const result = useMemo(() => {
    if (!part.brush) return null;
    const def = findBrushDefinition(part.brush.brush_id, sketch);
    if (!def) return null;
    const params = resolveBrushParamsForPart(def, part);
    const tables = buildPartArcTables(part);
    return renderBrush(def, params, tables);
    // anchors/subpath/brush 파라미터 + 굵기(stroke_width) + 사용자 브러쉬 정의 변경 시 재계산.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part.brush, part.stroke_width, part.anchors, part.subpath_breaks, part.subpath_closed, sketch?.brush_definitions]);

  if (!result || result.tiles.length === 0) return null;

  const t = part.transform ?? DEFAULT_TRANSFORM;
  const stroke = result.stroke !== 'none' ? result.stroke : undefined;
  const fill = result.fill !== 'none' ? result.fill : undefined;

  return (
    <Group
      x={t.x}
      y={t.y}
      rotation={t.rotation}
      scaleX={t.scaleX}
      scaleY={t.scaleY}
      // 타일은 시각 표현 전용 — 클릭/드래그는 밑의 spine Path 가 받는다.
      listening={false}
      visible={part.visible !== false}
    >
      {result.tiles.map((tile, i) => (
        <Group
          key={i}
          x={tile.x}
          y={tile.y}
          rotation={tile.rotationDeg}
          scaleX={tile.scaleX}
          scaleY={tile.scaleY}
          offsetX={tile.offsetX}
          offsetY={tile.offsetY}
        >
          {tile.paths.map((d, j) => (
            <Path
              key={j}
              data={d}
              stroke={stroke}
              strokeEnabled={stroke !== undefined}
              strokeWidth={result.strokeWidth}
              // 타일이 패스 방향으로 늘어나도(stretch) 선 두께는 일정하게 유지.
              strokeScaleEnabled={false}
              fill={fill}
              fillEnabled={fill !== undefined}
              listening={false}
            />
          ))}
        </Group>
      ))}
    </Group>
  );
}
