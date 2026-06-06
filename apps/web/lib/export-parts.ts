// 우측 패널 "내보내기" 섹션 — 선택된 파트들을 SVG / PNG / JPG 로 내보낸다.
//
// parts-to-svg.ts (서버측 정제 결과 직렬화) 와 달리 여기서는:
//  1) 각 파트의 transform (translate / rotate / scale) 을 SVG `<g transform>` 으로 그대로 보존
//  2) viewBox 를 "선택된 파트들의 월드 bbox" 로 잡아 결과 이미지가 선택 영역만 담도록 크롭
//  3) 브라우저에서 SVG → Image → Canvas → PNG/JPG dataURL 변환 (raster export)
//
// 회전이 들어 있는 파트도 정확한 bbox 를 위해 path-local bounding_box 의 4 코너에 transform 을
// 적용한 뒤 AABB 를 다시 계산한다.

import type { Part } from '@sketchflat/svg-schema';
import { compileAnchorsToD, DEFAULT_TRANSFORM, fillToCssColor } from '@sketchflat/svg-schema';

export type ExportFormat = 'PNG' | 'JPG' | 'SVG';

interface WorldBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 회전을 포함한 transform 을 path-local bbox 4 코너에 적용해 월드 AABB 를 구한다.
// 행렬 순서는 Konva 와 동일: M = T(tx,ty) · R(rot) · S(sx,sy).
function partWorldBBox(part: Part): WorldBBox {
  const t = part.transform ?? DEFAULT_TRANSFORM;
  const { x: bx, y: by, width: bw, height: bh } = part.bounding_box;
  if (bw === 0 && bh === 0) {
    return { x: t.x, y: t.y, width: 0, height: 0 };
  }
  const corners: Array<[number, number]> = [
    [bx, by],
    [bx + bw, by],
    [bx + bw, by + bh],
    [bx, by + bh],
  ];
  const rad = ((t.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [lx, ly] of corners) {
    const sx = lx * t.scaleX;
    const sy = ly * t.scaleY;
    const rx = sx * cos - sy * sin;
    const ry = sx * sin + sy * cos;
    const wx = rx + t.x;
    const wy = ry + t.y;
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function unionBBox(boxes: WorldBBox[]): WorldBBox {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.width === 0 && b.height === 0) continue;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderPathElement(part: Part, d: string): string {
  const attrs: string[] = [];
  // 그라디언트/패턴 fill 은 export 시 평균색으로 떨군다. 정확한 그라디언트 export 는
  // <defs> 등록·viewBox 매핑이 별도 필요해 v1 범위 밖.
  const fillCss = fillToCssColor(part.fill);
  if (fillCss && fillCss !== 'none') attrs.push(`fill="${escapeAttr(fillCss)}"`);
  else attrs.push('fill="none"');
  if (part.stroke && part.stroke !== 'none')
    attrs.push(`stroke="${escapeAttr(part.stroke)}"`);
  else attrs.push('stroke="none"');
  if (Number.isFinite(part.stroke_width))
    attrs.push(`stroke-width="${part.stroke_width}"`);
  if (part.stroke_dasharray && part.stroke_dasharray.length > 0)
    attrs.push(`stroke-dasharray="${part.stroke_dasharray.join(',')}"`);
  if (part.stroke_linecap) attrs.push(`stroke-linecap="${part.stroke_linecap}"`);
  if (part.stroke_linejoin) attrs.push(`stroke-linejoin="${part.stroke_linejoin}"`);
  attrs.push(`d="${escapeAttr(d)}"`);
  return `  <path ${attrs.join(' ')}/>`;
}

// 선택된 파트들을 viewBox 가 그들의 월드 bbox 인 SVG 문자열로 직렬화.
// 각 path 는 자기 transform 을 가진 `<g>` 로 감싸 캔버스 상 시각적 위치/회전/스케일을 그대로 보존한다.
// z_index 오름차순으로 그려야 위/아래 관계가 캔버스와 동일.
export function serializeSelectedPartsToSvg(parts: Part[]): {
  svg: string;
  bbox: WorldBBox;
} {
  if (parts.length === 0) {
    return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>', bbox: { x: 0, y: 0, width: 0, height: 0 } };
  }
  const ordered = [...parts].sort((a, b) => a.z_index - b.z_index);
  const bbox = unionBBox(ordered.map(partWorldBBox));

  // stroke 가 잘리지 않도록 살짝 패딩 — 가장 두꺼운 stroke_width 의 절반.
  const maxStroke = ordered.reduce(
    (m, p) => (p.stroke && p.stroke !== 'none' ? Math.max(m, p.stroke_width) : m),
    0,
  );
  const pad = maxStroke / 2;
  const vb = {
    x: bbox.x - pad,
    y: bbox.y - pad,
    width: Math.max(1, bbox.width + pad * 2),
    height: Math.max(1, bbox.height + pad * 2),
  };

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.width} ${vb.height}" width="${vb.width}" height="${vb.height}">`,
  );

  // 2단 계층: 카테고리 부모 그룹 > (선택적) group_id 자식 그룹 > transform 그룹 > path.
  // 일러스트레이터 레이어 패널에서 부위(part-body) → region(group-XX) 두 단계로 보이게 한다.
  // z_index 정렬은 카테고리 단위 안에서만 보존한다 — 의류 도식화의 카테고리들은 거의
  // 겹치지 않아 실용상 영향이 없고, 부위 그룹화의 이득이 더 크다.
  const byCategory = new Map<string, Part[]>();
  for (const part of ordered) {
    const key = part.category ?? 'other';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(part);
  }

  const renderPartWithTransform = (part: Part, indent: string) => {
    const d = compileAnchorsToD(part.anchors, part.subpath_breaks, part.subpath_closed);
    if (!d) return;
    const t = part.transform ?? DEFAULT_TRANSFORM;
    const tx = t.x;
    const ty = t.y;
    const rot = t.rotation ?? 0;
    const sx = t.scaleX ?? 1;
    const sy = t.scaleY ?? 1;
    const transformAttr = `translate(${tx} ${ty}) rotate(${rot}) scale(${sx} ${sy})`;
    lines.push(`${indent}<g transform="${transformAttr}">`);
    lines.push(`${indent}  ${renderPathElement(part, d).trim()}`);
    lines.push(`${indent}</g>`);
  };

  for (const [label, group] of byCategory) {
    lines.push(`  <g id="part-${escapeAttr(label)}" data-label="${escapeAttr(label)}">`);
    const byGroupId = new Map<string | null, Part[]>();
    for (const part of group) {
      const k = part.group_id ?? null;
      if (!byGroupId.has(k)) byGroupId.set(k, []);
      byGroupId.get(k)!.push(part);
    }
    for (const [gid, sub] of byGroupId) {
      if (gid !== null) {
        lines.push(`    <g id="group-${escapeAttr(gid)}">`);
        for (const part of sub) renderPartWithTransform(part, '      ');
        lines.push(`    </g>`);
      } else {
        for (const part of sub) renderPartWithTransform(part, '    ');
      }
    }
    lines.push(`  </g>`);
  }

  lines.push('</svg>');
  return { svg: lines.join('\n'), bbox: vb };
}

// SVG 문자열을 PNG/JPG dataURL 로 raster 화. scale 은 1×/2×/3× 같은 픽셀 밀도 배수.
// JPG 는 투명 배경을 지원하지 않아 흰색으로 깐다.
export async function rasterizeSvgToDataUrl(
  svg: string,
  width: number,
  height: number,
  scale: number,
  format: 'PNG' | 'JPG',
): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    if (format === 'JPG') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL(format === 'PNG' ? 'image/png' : 'image/jpeg', 0.92);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

// dataURL / SVG 문자열을 파일로 저장 트리거. 브라우저 다운로드 동작은 동기 — 호출 직후 곧바로 받기 시작.
export function downloadFile(filename: string, data: string, mime: string) {
  const isDataUrl = data.startsWith('data:');
  const href = isDataUrl ? data : `data:${mime};charset=utf-8,${encodeURIComponent(data)}`;
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export interface ExportRow {
  scale: number;
  format: ExportFormat;
  filename: string;
}

// 선택된 파트들을 한 ExportRow 설정에 따라 내보낸 후 다운로드.
export async function exportPartsAs(parts: Part[], row: ExportRow): Promise<void> {
  if (parts.length === 0) return;
  const { svg, bbox } = serializeSelectedPartsToSvg(parts);
  const safeName = row.filename.replace(/[\\/:*?"<>|]/g, '_').trim() || 'export';
  if (row.format === 'SVG') {
    downloadFile(`${safeName}.svg`, svg, 'image/svg+xml');
    return;
  }
  const dataUrl = await rasterizeSvgToDataUrl(
    svg,
    bbox.width,
    bbox.height,
    row.scale,
    row.format,
  );
  downloadFile(
    `${safeName}.${row.format === 'PNG' ? 'png' : 'jpg'}`,
    dataUrl,
    row.format === 'PNG' ? 'image/png' : 'image/jpeg',
  );
}
