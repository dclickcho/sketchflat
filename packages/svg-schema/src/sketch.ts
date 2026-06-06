import { z } from 'zod';
import { PartSchema } from './parts';
import { AnnotationSchema } from './annotations';
import { ArtboardSchema } from './artboards';
import { BrushDefinitionSchema } from './brushes';

export const GarmentTypeSchema = z.enum([
  'tshirt',
  'blouse',
  'shirt',
  'sweater',
  'cardigan',
  'jacket',
  'coat',
  'dress',
  'skirt',
  'pants',
  'shorts',
  'jumpsuit',
  'vest',
  'other',
]);
export type GarmentType = z.infer<typeof GarmentTypeSchema>;

export const ViewSchema = z.enum(['front', 'back', 'side']);
export type View = z.infer<typeof ViewSchema>;

const SketchObject = z.object({
  schema_version: z.literal('1.0.0'),
  sketch_id: z.string().uuid(),
  garment_type: GarmentTypeSchema,
  view: ViewSchema,
  canvas: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  parts: z.array(PartSchema),
  raw_svg: z.string().optional(),
  annotations: z.array(AnnotationSchema).default([]),
  // 대지 목록. 과거 데이터는 이 필드가 없을 수 있어 default([])로 보정.
  artboards: z.array(ArtboardSchema).default([]),
  // 그룹 이름 매핑 — group_id → 사용자 지정 라벨. 누락된 group_id 는 UI 가 "그룹" 으로 폴백.
  group_names: z.record(z.string(), z.string()).default({}),
  // 그룹 부모 매핑 — child_group_id → parent_group_id. 키에 없는 그룹은 최상위 그룹.
  // 이 필드 덕분에 그룹을 다른 그룹 안에 중첩(그룹 안의 그룹)으로 보관할 수 있다.
  group_parents: z.record(z.string(), z.string()).default({}),
  // 이 스케치에서 사용 가능한 사용자 정의 브러쉬. 프리셋(모듈 상수)과 합쳐 Part.brush.brush_id 를
  // 해석한다. 과거 데이터는 이 필드가 없어 default([]) 로 보정.
  brush_definitions: z.array(BrushDefinitionSchema).default([]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// Cross-field invariant: parts가 비어있으면 raw_svg 폴백 필요.
// 둘 다 없으면 검증 실패.
export const SketchSchema = SketchObject.refine(
  (data) => data.parts.length > 0 || (data.raw_svg !== undefined && data.raw_svg.length > 0),
  {
    message: 'parts가 비어있으면 raw_svg가 반드시 필요합니다',
    path: ['parts'],
  },
);
export type Sketch = z.infer<typeof SketchSchema>;
