import { DEFAULT_TRANSFORM, type Part } from '../src/parts';

// 케이스마다 spread로 부분 변형해서 사용.
// SketchSchema.safeParse에 그대로 통과해야 하는 base 도식화.
export const validCollarPart: Part = {
  id: 'part_collar_001',
  category: 'collar',
  subtype: 'shirt_collar',
  svg_paths: ['M 0 50 L 100 50'],
  fill: 'none',
  stroke: '#000000',
  stroke_width: 1.5,
  anchors: [
    { id: 'neck_left', x: 0, y: 50, type: 'connection', kind: 'corner' },
    { id: 'neck_right', x: 100, y: 50, type: 'connection', kind: 'corner' },
    { id: 'collar_top_center', x: 50, y: 30, type: 'edit_point', kind: 'corner' },
  ],
  bounding_box: { x: 0, y: 30, width: 100, height: 20 },
  z_index: 1,
  editable: true,
  swappable: true,
  transform: DEFAULT_TRANSFORM,
  metadata: {},
};

export const baseSketchInput = {
  schema_version: '1.0.0' as const,
  sketch_id: '550e8400-e29b-41d4-a716-446655440000',
  garment_type: 'shirt',
  view: 'front',
  canvas: { width: 800, height: 1000 },
  parts: [validCollarPart],
  annotations: [],
  created_at: '2026-04-29T00:00:00.000Z',
  updated_at: '2026-04-29T00:00:00.000Z',
};
