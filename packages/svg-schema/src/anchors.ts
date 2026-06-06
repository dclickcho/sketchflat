import { z } from 'zod';

export const AnchorTypeSchema = z.enum(['connection', 'edit_point', 'ref_only']);
export type AnchorType = z.infer<typeof AnchorTypeSchema>;

// 베지어 곡선 편집 모드.
// - corner: 두 핸들이 독립적. 한쪽 드래그가 반대쪽에 영향 없음.
// - smooth: 두 핸들이 앵커를 기준으로 같은 직선 위 + 같은 길이 (대칭).
// - asymmetric: 같은 직선 위지만 길이는 독립.
// 기본 'corner'를 부여해 기존 데이터(handle 없음)가 그대로 통과하도록.
export const AnchorKindSchema = z.enum(['corner', 'smooth', 'asymmetric']);
export type AnchorKind = z.infer<typeof AnchorKindSchema>;

// 핸들 좌표는 캔버스 절대 좌표. 앵커 (x, y)에 대한 상대 offset이 아니라 그대로 SVG path
// `C x1 y1 x2 y2 x y` 인자에 들어가는 값. 앵커를 옮길 때 핸들도 같이 평행이동시키는 책임은
// 호출자(스토어 업데이트)가 진다.
export const HandlePointSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type HandlePoint = z.infer<typeof HandlePointSchema>;

export const AnchorSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  type: AnchorTypeSchema,
  kind: AnchorKindSchema.default('corner'),
  // handle_in: 직전 anchor → 이 anchor 진입 시 사용되는 control point. (cubic의 두 번째 control)
  // handle_out: 이 anchor → 다음 anchor 진출 시 사용되는 control point. (cubic의 첫 번째 control)
  // 둘 다 없으면 양 옆으로 직선 연결.
  handle_in: HandlePointSchema.optional(),
  handle_out: HandlePointSchema.optional(),
});
export type Anchor = z.infer<typeof AnchorSchema>;
