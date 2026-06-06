import { z } from 'zod';

// 캔버스 위에 자유롭게 배치되는 대지(Artboard). sketch.canvas와는 별개로 동작하며,
// 사용자가 대지 도구로 만든 영역을 가리킨다. 좌표는 캔버스(world) 좌표 기준.
export const ArtboardSchema = z.object({
  id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type Artboard = z.infer<typeof ArtboardSchema>;
