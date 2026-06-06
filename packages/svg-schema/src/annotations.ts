import { z } from 'zod';

export const AnnotationTypeSchema = z.enum([
  'size_label',
  'stitch_note',
  'material_note',
  'general_note',
]);
export type AnnotationType = z.infer<typeof AnnotationTypeSchema>;

export const MeasurementUnitSchema = z.enum(['cm', 'inch']);
export type MeasurementUnit = z.infer<typeof MeasurementUnitSchema>;

export const AnnotationSchema = z.object({
  id: z.string().min(1),
  type: AnnotationTypeSchema,
  anchor_point: z.object({
    x: z.number(),
    y: z.number(),
  }),
  text: z.string(),
  measurement_key: z.string().optional(),
  measurement_value: z.number().optional(),
  measurement_unit: MeasurementUnitSchema.default('cm'),
});
export type Annotation = z.infer<typeof AnnotationSchema>;
