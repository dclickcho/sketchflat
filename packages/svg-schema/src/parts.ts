import { z } from 'zod';
import { AnchorSchema } from './anchors';
import { BrushApplicationSchema } from './brushes';

export const PartCategorySchema = z.enum([
  'collar',
  'neckline',
  'sleeve',
  'cuff',
  'shoulder',
  'body',
  'placket',
  'pocket',
  'hem',
  'waistband',
  'leg',
  'pants_pocket',
  'button',
  'zipper',
  'label',
  'other',
]);
export type PartCategory = z.infer<typeof PartCategorySchema>;

export const BoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

// Konva 변환 핸들로 적용된 이동/회전/스케일을 그대로 보관.
// svg_paths의 좌표는 baking 없이 원본 그대로 두고, 렌더 시점에 이 transform을 노드에 적용.
export const TransformSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  rotation: z.number().default(0),
  scaleX: z.number().default(1),
  scaleY: z.number().default(1),
});
export type Transform = z.infer<typeof TransformSchema>;

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
};

export const StrokeLinecapSchema = z.enum(['butt', 'round', 'square']);
export type StrokeLinecap = z.infer<typeof StrokeLinecapSchema>;

export const StrokeLinejoinSchema = z.enum(['miter', 'round', 'bevel']);
export type StrokeLinejoin = z.infer<typeof StrokeLinejoinSchema>;

// 그라디언트/패턴 fill 표현 — .ai/PDF 파일에서 SVG 로 변환된 부품이 단색이 아닌 색을
// 가질 때 사용. Konva 렌더러는 fillLinearGradient*/fillRadialGradient*/fillPatternImage
// 로 매핑하고, brush01.ai 처럼 일러스트레이터가 만든 축형/방사형/타일링 그라디언트를
// 보존한다. 좌표는 SVG viewBox(=device) 공간이며 gradientUnits="userSpaceOnUse" 와 일치.
export const ColorStopSchema = z.object({
  offset: z.number().min(0).max(1),
  // #rrggbb 또는 #rrggbbaa. 워커가 이미 정규화한 값을 그대로 받는다.
  color: z.string(),
});
export type ColorStop = z.infer<typeof ColorStopSchema>;

export const LinearGradientFillSchema = z.object({
  kind: z.literal('linear'),
  stops: z.array(ColorStopSchema).min(2),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
});
export type LinearGradientFill = z.infer<typeof LinearGradientFillSchema>;

// PDF 의 RadialAxialShading 은 두 원(시작/끝)으로 정의된다. SVG <radialGradient>
// 는 보통 단일 원만 노출하지만 fx/fy(시작 초점) + cx/cy/r 로 시작 원을 근사한다.
// 정확도가 더 필요하면 Konva 의 fillRadialGradientStartPoint/Radius 양쪽을 다 사용한다.
export const RadialGradientFillSchema = z.object({
  kind: z.literal('radial'),
  stops: z.array(ColorStopSchema).min(2),
  // 시작 원
  fx: z.number(),
  fy: z.number(),
  r0: z.number().nonnegative(),
  // 끝 원
  cx: z.number(),
  cy: z.number(),
  r1: z.number().nonnegative(),
});
export type RadialGradientFill = z.infer<typeof RadialGradientFillSchema>;

// 타일링 패턴. Konva 는 SVG <pattern> 을 직접 지원하지 않으므로 캔버스 렌더 시점에
// 인라인 SVG 문자열을 HTMLImageElement 로 래스터화해 fillPatternImage 로 넘긴다.
// svg 필드는 viewBox="0 0 tileWidth tileHeight" 단일 페이지 SVG 여야 한다.
export const PatternFillSchema = z.object({
  kind: z.literal('pattern'),
  svg: z.string(),
  tileWidth: z.number().positive(),
  tileHeight: z.number().positive(),
  // viewBox 공간에서 적용할 추가 변환(SVG patternTransform 과 같은 의미).
  // 단순화를 위해 단일 2x3 행렬. 미지정 시 항등.
  transform: z
    .object({
      a: z.number(),
      b: z.number(),
      c: z.number(),
      d: z.number(),
      e: z.number(),
      f: z.number(),
    })
    .optional(),
});
export type PatternFill = z.infer<typeof PatternFillSchema>;

// Part.fill 은 과거 단색 string("#abc"/"none"/CSS 함수형) 만 받았으나, 그라디언트/패턴
// 도 허용하는 유니온으로 확장. svg-to-parts 가 단색이면 string, 아니면 객체로 채운다.
// 캔버스 렌더러는 string 인지 객체인지 분기.
export const PartFillSchema = z.union([
  z.string(),
  LinearGradientFillSchema,
  RadialGradientFillSchema,
  PatternFillSchema,
]);
export type PartFill = z.infer<typeof PartFillSchema>;

// 그라디언트/패턴 fill 을 단일 CSS 색 문자열로 환원. 색 피커·SVG 출력·KonvaImage 등
// 그라디언트 prop 을 표현할 수 없는 경로에서 사용. 폴백:
//   - 단색 string → 그대로
//   - linear/radial → stops 의 평균색
//   - pattern → 'none' (대표색 없음)
export function fillToCssColor(fill: PartFill | undefined | null): string {
  if (fill === undefined || fill === null) return 'none';
  if (typeof fill === 'string') return fill;
  if (fill.kind === 'linear' || fill.kind === 'radial') {
    const stops = fill.stops;
    if (!stops || stops.length === 0) return 'none';
    let R = 0, G = 0, B = 0, n = 0;
    for (const s of stops) {
      const h = /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : null;
      if (!h) continue;
      R += parseInt(h.slice(1, 3), 16);
      G += parseInt(h.slice(3, 5), 16);
      B += parseInt(h.slice(5, 7), 16);
      n += 1;
    }
    if (n === 0) return stops[0]?.color ?? 'none';
    const to2 = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
    return `#${to2(R)}${to2(G)}${to2(B)}`;
  }
  return 'none';
}

export const PartSchema = z.object({
  id: z.string().min(1),
  category: PartCategorySchema,
  subtype: z.string().optional(),
  svg_paths: z.array(z.string()),
  // fill 은 단색 string(과거 데이터·도식화 라인) 또는 그라디언트/패턴 객체(.ai/PDF 출처).
  fill: PartFillSchema.default('none'),
  stroke: z.string().default('#000000'),
  stroke_width: z.number().default(1.5),
  // 점선 정보. SVG `stroke-dasharray`를 그대로 보관 → Konva.Path `dash` prop으로 전달.
  stroke_dasharray: z.array(z.number()).optional(),
  stroke_linecap: StrokeLinecapSchema.optional(),
  stroke_linejoin: StrokeLinejoinSchema.optional(),
  anchors: z.array(AnchorSchema),
  // 한 svg_paths[0] 안에 여러 sub-path가 있을 때(예: 의류 디테일 라인 + 외곽), anchors 배열을
  // 어디서 끊는지 가리키는 인덱스. 항상 오름차순. 0은 암묵적이므로 포함시키지 않는 것이 관례.
  // 비워두면 anchors 전체가 단일 sub-path로 간주된다.
  subpath_breaks: z.array(z.number().int().nonnegative()).optional(),
  // 각 sub-path가 Z(close path)로 닫혀 있는지. 길이는 sub-path 개수와 일치해야 의미가 있다 —
  // 길이가 어긋나면 컴파일러가 false 폴백을 적용한다.
  subpath_closed: z.array(z.boolean()).optional(),
  bounding_box: BoundingBoxSchema,
  z_index: z.number().int(),
  editable: z.boolean().default(true),
  swappable: z.boolean().default(true),
  // 옵셔널: 누락된 기존 데이터는 DEFAULT_TRANSFORM으로 처리.
  transform: TransformSchema.default(DEFAULT_TRANSFORM),
  metadata: z.record(z.string(), z.string()).default({}),
  // 정제 (refinement) 결과. Phase B (face-decompose) 가 채우는 face id, Phase C (hierarchy)
  // 가 채우는 parent face id. 정제 미적용 데이터는 둘 다 undefined.
  face_id: z.string().optional(),
  parent_face_id: z.string().optional(),
  // 그룹 ID — 같은 group_id를 공유하는 파트는 한 단위로 선택/이동. 옵셔널이라 과거 데이터 호환.
  group_id: z.string().optional(),
  // 표시/잠금 플래그. Figma 컨텍스트 메뉴의 "표시/숨기기"·"잠금/잠금 해제"에서 토글.
  // 미정의(=과거 데이터)는 visible:true / locked:false 와 동일하게 취급.
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  // 사용자 지정 레이어 이름. 비어 있으면 UI 가 "Vector N" 폴백을 그린다.
  name: z.string().optional(),
  // 패턴 브러쉬 적용 정보. 존재하면 이 파트의 svg_paths 는 "브러쉬가 따라갈 패스(spine)"로
  // 해석되고, 캔버스는 brush 정의를 따라 타일을 동적 렌더한다. Expand 시 실제 파트로 굽고
  // 이 필드를 제거한다. undefined = 일반 파트 (과거 데이터 호환).
  brush: BrushApplicationSchema.optional(),
});
export type Part = z.infer<typeof PartSchema>;

// 정제 산출물. Face 는 Phase B 가 만들어내는 폐곡선 토폴로지 단위. 원본 anchor reference
// 시퀀스를 그대로 보존하고, 9(b)/9(c) 가 만들어낸 직선 bridge segment 만 별도 마킹한다.
//
// anchor_refs[i] 는 face 윤곽 i 번째 점이 어느 part 의 어느 anchor 인지 가리킨다.
// bridge_segments[k] = { from: i, to: i+1 } 형태로, 윤곽의 i 번째→i+1 번째 구간이 bridge
// (큐빅 핸들 무시, 직선) 임을 알린다.
export const FaceAnchorRefSchema = z.object({
  part_id: z.string(),
  anchor_index: z.number().int().nonnegative(),
});
export type FaceAnchorRef = z.infer<typeof FaceAnchorRefSchema>;

export const FaceBridgeSegmentSchema = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
});
export type FaceBridgeSegment = z.infer<typeof FaceBridgeSegmentSchema>;

export const FaceSchema = z.object({
  id: z.string().min(1),
  anchor_refs: z.array(FaceAnchorRefSchema),
  bridge_segments: z.array(FaceBridgeSegmentSchema).default([]),
  // 평탄화된 폴리곤 윤곽 (PiP 와 bbox 계산용). 토폴로지 식별을 위한 스캐폴드일 뿐,
  // 시각적 렌더에는 사용하지 않는다.
  flat_polygon: z.array(z.object({ x: z.number(), y: z.number() })),
  bounding_box: BoundingBoxSchema,
  // 음수면 시계방향 → Phase B 가 폐기. 양수만 살아남는다.
  signed_area: z.number(),
});
export type Face = z.infer<typeof FaceSchema>;
