import { z } from 'zod';

// 패턴 브러쉬 (Pattern Brush) 데이터 모델. 일러스트레이터의 패턴 브러쉬를 차용한다.
//
// 좌표 규약 (타일-로컬):
//  - 타일 아트는 "수평"으로 author 한다. 패스 진행 방향 = 타일-로컬 +x, 패스 법선 = +y.
//  - 패스는 타일의 y=0 (baseline) 을 따라간다. width 만큼 +x 로 진행하면 다음 타일이 이어진다.
//  - 렌더 엔진은 호 길이 위치마다 타일을 (회전=접선각, 평행이동=패스 점) 으로 배치한다.

// 브러쉬 타일 한 장. 단색 라인아트를 가정 — path d 문자열 배열로 보관한다.
export const BrushTileSchema = z.object({
  // SVG path `d` 문자열들. 모두 타일-로컬 좌표. fill/stroke 는 BrushDefinition 가 일괄 지정.
  paths: z.array(z.string()).min(1),
  // 패스 진행 방향(타일-로컬 x) 길이. Side 타일은 이 값만큼 반복 간격을 둔다.
  width: z.number().positive(),
  // 법선 방향(타일-로컬 y) 높이. 미리보기 bbox/스케일 계산용.
  height: z.number().positive(),
});
export type BrushTile = z.infer<typeof BrushTileSchema>;

// 패스에 타일을 맞추는 방식 (일러스트 "Fit" 옵션).
//  - stretch:     Side 타일을 늘이거나 줄여 패스 길이에 정확히 맞춤.
//  - space:       타일 크기는 유지하고 타일 사이에 여백을 추가해 맞춤.
//  - approximate: 가장 가까운 정수 개수로 반복하고 미세하게 늘여 근사.
export const BrushFitSchema = z.enum(['stretch', 'space', 'approximate']);
export type BrushFit = z.infer<typeof BrushFitSchema>;

// 타일 채색 방식. 의류 도식화는 보통 'none'(원본 색) 또는 stroke 색 오버라이드로 충분.
export const BrushColorizationSchema = z.enum(['none', 'tint', 'hueShift']);
export type BrushColorization = z.infer<typeof BrushColorizationSchema>;

// 브러쉬 정의 — 프리셋이거나 사용자가 SVG 로 반입한 것.
export const BrushDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  // 의류 도식화 분류용 자유 문자열 ('zipper' | 'lace' | 'pleat' | 'stitch' | 'trim' ...).
  category: z.string().default('other'),
  // 프리셋(모듈 상수)인지 사용자가 반입(스케치에 저장)한 것인지.
  source: z.enum(['preset', 'user']).default('user'),
  tiles: z.object({
    // 패스를 따라 반복되는 본체 타일 (필수).
    side: BrushTileSchema,
    // 패스 시작/끝 캡 (옵셔널).
    start: BrushTileSchema.optional(),
    end: BrushTileSchema.optional(),
    // 코너에서 교체되는 타일 (옵셔널). 미지정 시 Side 가 그대로 코너를 돈다.
    outerCorner: BrushTileSchema.optional(),
    innerCorner: BrushTileSchema.optional(),
  }),
  // 기본 파라미터 — Part 적용 시 BrushApplication 이 오버라이드 가능.
  scale: z.number().positive().default(1),
  // 타일 사이 추가 여백 (타일 width 대비 비율, 0 = 빈틈없이). fit='space' 에서 의미.
  spacing: z.number().min(0).default(0),
  flipAlong: z.boolean().default(false), // 패스 방향(x) 뒤집기.
  flipAcross: z.boolean().default(false), // 법선(y) 뒤집기.
  fit: BrushFitSchema.default('stretch'),
  colorization: BrushColorizationSchema.default('none'),
  // 렌더 기본 stroke/fill. 'none' 이면 해당 속성 생략.
  stroke: z.string().default('#000000'),
  stroke_width: z.number().nonnegative().default(1),
  fill: z.string().default('none'),
});
export type BrushDefinition = z.infer<typeof BrushDefinitionSchema>;

// Part 에 붙는 브러쉬 적용 정보. brush_id 로 정의를 참조하고, 나머지 필드는
// 정의 기본값을 덮어쓰는 옵셔널 오버라이드 (undefined = 정의 기본값 사용).
export const BrushApplicationSchema = z.object({
  brush_id: z.string().min(1),
  scale: z.number().positive().optional(),
  spacing: z.number().min(0).optional(),
  flipAlong: z.boolean().optional(),
  flipAcross: z.boolean().optional(),
  fit: BrushFitSchema.optional(),
  stroke: z.string().optional(),
  stroke_width: z.number().nonnegative().optional(),
});
export type BrushApplication = z.infer<typeof BrushApplicationSchema>;

// 정의 + 적용 오버라이드를 합쳐 "실효 파라미터"를 만든다. 렌더 엔진/Expand 의 단일 진입점.
export interface ResolvedBrushParams {
  scale: number;
  spacing: number;
  flipAlong: boolean;
  flipAcross: boolean;
  fit: BrushFit;
  stroke: string;
  stroke_width: number;
  fill: string;
}

export function resolveBrushParams(
  def: BrushDefinition,
  app?: BrushApplication,
): ResolvedBrushParams {
  return {
    scale: app?.scale ?? def.scale,
    spacing: app?.spacing ?? def.spacing,
    flipAlong: app?.flipAlong ?? def.flipAlong,
    flipAcross: app?.flipAcross ?? def.flipAcross,
    fit: app?.fit ?? def.fit,
    stroke: app?.stroke ?? def.stroke,
    stroke_width: app?.stroke_width ?? def.stroke_width,
    fill: def.fill,
  };
}
