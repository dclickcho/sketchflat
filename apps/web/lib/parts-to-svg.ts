// Part[] → SVG 문자열. 정제(refinement) 결과를 Storage 에 저장하기 위한 서버측 직렬화기.
//
// 입력 Part 의 svg_paths 는 무시하고 anchors 를 `compileAnchorsToD` 로 다시 컴파일한다 —
// 이 경로가 Phase A/B 가 (앞으로) 추가할 bridge anchor 들을 포함한 최종 형태이기 때문.
// 현재 Phase 1 의 refineSketch 는 anchor 자체를 mutate 하지 않으므로 결과는 raw 와 동일.
//
// 원본 `<style>` 블록 + `source_class` 메타를 그대로 재사용해 렌더 결과가 raw 와 시각적으로
// 동일하도록 유지. class 정보가 없는 part 는 explicit attribute (stroke / stroke-width 등) 로
// 직접 출력.

import type { Part } from '@sketchflat/svg-schema';
import { compileAnchorsToD, fillToCssColor } from '@sketchflat/svg-schema';

export interface SerializeOptions {
  parts: Part[];
  canvas: { width: number; height: number };
  /** 원본 viewBox 문자열. null 이면 canvas 로부터 생성. */
  viewBox?: string | null;
  /** 원본 `<style>` 태그들의 결합 텍스트. 없으면 explicit attribute 만 사용. */
  styleBlock?: string;
}

export function serializePartsToSvg(opts: SerializeOptions): string {
  const { parts, canvas, viewBox, styleBlock } = opts;
  const vb = viewBox ?? `0 0 ${canvas.width} ${canvas.height}`;

  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${escapeAttr(vb)}">`);
  if (styleBlock && styleBlock.trim().length > 0) {
    lines.push(`<style type="text/css">${styleBlock.trim()}</style>`);
  }

  // 2단 계층: <g id="part-{category}"> 부모 안에 같은 category 의 path 들이 모인다.
  // group_id 가 있는 파트는 다시 <g id="group-{group_id}"> 자식 그룹으로 묶여
  // 일러스트레이터 레이어 패널에서 부위 → region 두 단계로 보이게 한다.
  // 입력 순서가 z-order 이므로 안정 정렬을 위해 그대로 보존한다.
  const byCategory = new Map<string, Part[]>();
  for (const part of parts) {
    const key = part.category ?? 'other';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(part);
  }

  for (const [label, group] of byCategory) {
    lines.push(`  <g id="part-${escapeAttr(label)}" data-label="${escapeAttr(label)}">`);
    // category 안에서 group_id 별로 다시 묶고, group_id 가 없으면 카테고리 그룹 직접 자식으로.
    const byGroupId = new Map<string | null, Part[]>();
    for (const part of group) {
      const k = part.group_id ?? null;
      if (!byGroupId.has(k)) byGroupId.set(k, []);
      byGroupId.get(k)!.push(part);
    }
    for (const [gid, sub] of byGroupId) {
      if (gid !== null) {
        lines.push(`    <g id="group-${escapeAttr(gid)}">`);
        for (const part of sub) {
          const d = compileAnchorsToD(part.anchors, part.subpath_breaks, part.subpath_closed);
          if (!d) continue;
          lines.push(`    ${renderPartElement(part, d, !!styleBlock).trim()}`);
        }
        lines.push(`    </g>`);
      } else {
        for (const part of sub) {
          const d = compileAnchorsToD(part.anchors, part.subpath_breaks, part.subpath_closed);
          if (!d) continue;
          lines.push(renderPartElement(part, d, !!styleBlock));
        }
      }
    }
    lines.push(`  </g>`);
  }

  lines.push('</svg>');
  return lines.join('\n');
}

function renderPartElement(part: Part, d: string, hasStyleBlock: boolean): string {
  const cls = part.metadata?.['source_class'];
  const attrs: string[] = [];
  if (hasStyleBlock && cls) {
    // 원본 class 가 있고 styleBlock 으로 스타일이 정의돼 있으면 class 만 출력.
    attrs.push(`class="${escapeAttr(cls)}"`);
  } else {
    // explicit attribute 출력.
    // 그라디언트/패턴 객체 fill 은 평균색으로 떨군다(직렬화 라운드트립용 — 정확 표현은 raw_svg).
    const fillCss = fillToCssColor(part.fill);
    if (fillCss && fillCss !== 'none') attrs.push(`fill="${escapeAttr(fillCss)}"`);
    else attrs.push('fill="none"');
    if (part.stroke && part.stroke !== 'none')
      attrs.push(`stroke="${escapeAttr(part.stroke)}"`);
    if (Number.isFinite(part.stroke_width))
      attrs.push(`stroke-width="${part.stroke_width}"`);
    if (part.stroke_dasharray && part.stroke_dasharray.length > 0)
      attrs.push(`stroke-dasharray="${part.stroke_dasharray.join(',')}"`);
    if (part.stroke_linecap) attrs.push(`stroke-linecap="${part.stroke_linecap}"`);
    if (part.stroke_linejoin) attrs.push(`stroke-linejoin="${part.stroke_linejoin}"`);
  }
  // 정제 메타 — face 계층 디버깅/재구성을 위해 data-* 로 함께 출력.
  if (part.face_id) attrs.push(`data-face-id="${escapeAttr(part.face_id)}"`);
  if (part.parent_face_id)
    attrs.push(`data-parent-face-id="${escapeAttr(part.parent_face_id)}"`);

  attrs.push(`d="${escapeAttr(d)}"`);
  return `  <path ${attrs.join(' ')}/>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
