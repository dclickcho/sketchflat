// 새로 파싱된 라이브러리 SVG 의 part[] 를 캔버스 위 특정 bbox 안에 맞춰 넣기 위한 affine 변환.
// 앵커/svg_paths 좌표는 그대로 두고, 각 part 의 transform.x/y/scaleX/scaleY 만 채워서 렌더 시점에
// 변환이 적용되도록 한다. (Konva.Path 에 scaleX/scaleY/x/y 가 prop 으로 전달되는 패턴과 동일.)

import type { Part } from '@sketchflat/svg-schema';
import { flattenPart } from '@sketchflat/svg-schema';

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 비율 유지 contain — 두 축 중 더 빡빡한 쪽에 맞춰 스케일을 결정한다.
// 입력 parts 가 비어 있거나 source bbox 가 0 이면 변환 없이 원본 반환.
export function fitPartsToBbox(parts: Part[], target: BBox): Part[] {
  if (parts.length === 0) return parts;

  const source = computeLocalBbox(parts);
  if (!source || source.width <= 0 || source.height <= 0) return parts;
  if (target.width <= 0 || target.height <= 0) return parts;

  const scale = Math.min(target.width / source.width, target.height / source.height);
  // source bbox 의 중심을 target bbox 의 중심에 정렬. world = scale * local + translate.
  const sourceCx = source.x + source.width / 2;
  const sourceCy = source.y + source.height / 2;
  const targetCx = target.x + target.width / 2;
  const targetCy = target.y + target.height / 2;
  const tx = targetCx - sourceCx * scale;
  const ty = targetCy - sourceCy * scale;

  return parts.map((p) => ({
    ...p,
    transform: {
      x: tx,
      y: ty,
      rotation: 0,
      scaleX: scale,
      scaleY: scale,
    },
  }));
}

// part-local 좌표계에서의 통합 bbox. flattenPart 로 cubic 곡선까지 평탄화해서 정확한 외곽을 얻는다.
function computeLocalBbox(parts: Part[]): BBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasAny = false;

  for (const p of parts) {
    const flats = flattenPart(p);
    for (const sub of flats) {
      for (const pt of sub.points) {
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
        hasAny = true;
      }
    }
  }
  if (!hasAny) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
