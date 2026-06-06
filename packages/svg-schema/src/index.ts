export * from './anchors';
export * from './parts';
export * from './annotations';
export * from './artboards';
export * from './sketch';
export * from './swap';
export * from './path-parser';
export * from './path-compiler';
export * from './category-zorder';
export * from './arc-length';
export * from './brushes';
export { refineSketch } from './refinement';
export type {
  RefineOptions,
  RefineResult,
  RefinementRole,
  ClassifyOptions,
  FlattenOptions,
  PhaseAOptions,
  FaceDecomposeOptions,
  HierarchyOptions,
} from './refinement';
// Pathfinder (Unite/Divide) 등 외부 사용처가 anchors → 평탄 폴리곤 변환을 재사용할 수 있도록 노출.
export { flattenPart } from './refinement/flatten';
export type { FlatPoint, FlatSubpath } from './refinement/flatten';
