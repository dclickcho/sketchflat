// 정제 (refinement) 파이프라인의 공개 진입점.
//
// 입력 Part[] 을 받아:
//  1. classify → 구조선/장식선 분류
//  2. flatten → 구조선 큐빅을 임시 폴리라인으로 (식별용 스캐폴드)
//  3. applyPhaseA → 9(a)/9(b)/9(c) 의 bridge segment 후보 + 폐기 sub-path
//  4. decomposeFaces → 좌회전 traversal 로 face 추출 (원본 anchor 보존)
//  5. buildHierarchy → 장식선의 parent_face_id 결정 (PiP + bbox 다수결)
//
// 반환은 `parts` (parent_face_id 가 채워진 새 배열) 와 `faces`. 호출자가 이걸로 Sketch 를
// 갱신하거나 별도 metadata 로 보관.

import type { Face, Part } from '../parts';
import { classifyParts, type ClassifyOptions, type RefinementRole } from './classify';
import { flattenPart, type FlattenOptions } from './flatten';
import { applyPhaseA, type PhaseAOptions, type PartFlat } from './rules';
import { decomposeFaces, type FaceDecomposeOptions } from './face-decompose';
import { buildHierarchy, type HierarchyOptions } from './hierarchy';

export interface RefineOptions {
  classify?: ClassifyOptions;
  flatten?: FlattenOptions;
  phaseA?: PhaseAOptions;
  faceDecompose?: FaceDecomposeOptions;
  hierarchy?: HierarchyOptions;
}

export interface RefineResult {
  /** parent_face_id 가 채워진 part 배열 (입력과 같은 순서/length). */
  parts: Part[];
  /** Phase B 가 추출한 face 목록. */
  faces: Face[];
  /** part_id → 분류 결과. 디버깅/회귀용. */
  roles: Map<string, RefinementRole>;
  /** root 자식으로 떨어진 장식 part 수. orphan 비율 모니터링용. */
  orphanCount: number;
}

export function refineSketch(parts: Part[], opts: RefineOptions = {}): RefineResult {
  const roles = classifyParts(parts, opts.classify);

  const structuralParts = parts.filter((p) => roles.get(p.id) === 'structural');
  const decorativeParts = parts.filter((p) => roles.get(p.id) === 'decorative');

  // Phase 0: 평탄화.
  const structural: PartFlat[] = structuralParts.map((part) => ({
    part,
    subpaths: flattenPart(part, opts.flatten),
  }));

  // Phase A: 규칙 적용 → bridge 후보 + 폐기 sub-path.
  const phaseA = applyPhaseA(structural, opts.phaseA);

  // Phase B: face 추출.
  const faces = decomposeFaces(structural, phaseA, opts.faceDecompose);

  // Phase C: 장식의 parent_face_id 결정.
  const hierarchy = buildHierarchy(decorativeParts, faces, structuralParts, opts.hierarchy);

  // parts 에 parent_face_id 주입 — 원본 part 객체를 mutate 하지 않고 복사.
  const outParts: Part[] = parts.map((p) => {
    const parent = hierarchy.parentByPart.get(p.id);
    if (parent === undefined) return p;
    return { ...p, parent_face_id: parent };
  });

  return {
    parts: outParts,
    faces,
    roles,
    orphanCount: hierarchy.orphanCount,
  };
}

export type { ClassifyOptions, FlattenOptions, PhaseAOptions, FaceDecomposeOptions, HierarchyOptions };
export type { RefinementRole };
