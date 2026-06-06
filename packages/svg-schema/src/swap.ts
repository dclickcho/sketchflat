import type { Sketch } from './sketch';
import type { Part } from './parts';

export class PartNotFoundError extends Error {
  constructor(partId: string) {
    super(`Part not found: ${partId}`);
    this.name = 'PartNotFoundError';
  }
}

export class CategoryMismatchError extends Error {
  constructor(oldCategory: string, newCategory: string) {
    super(`Category mismatch: ${oldCategory} → ${newCategory}`);
    this.name = 'CategoryMismatchError';
  }
}

export class AnchorMismatchError extends Error {
  constructor(missingIds: string[]) {
    super(`Anchor ID mismatch: missing ${missingIds.join(', ')}`);
    this.name = 'AnchorMismatchError';
  }
}

// MVP: affine transform 수학은 Week 7-8 캔버스 인터랙션 붙일 때 추가.
// 1단계는 검증만 — 통과하면 부품 객체를 그대로 교체.
export function swapPart(sketch: Sketch, oldPartId: string, newPart: Part): Sketch {
  const oldPart = sketch.parts.find((p) => p.id === oldPartId);
  if (!oldPart) {
    throw new PartNotFoundError(oldPartId);
  }

  if (oldPart.category !== newPart.category) {
    throw new CategoryMismatchError(oldPart.category, newPart.category);
  }

  const oldConnectionIds = new Set(
    oldPart.anchors.filter((a) => a.type === 'connection').map((a) => a.id),
  );
  const newConnectionIds = new Set(
    newPart.anchors.filter((a) => a.type === 'connection').map((a) => a.id),
  );

  const missing: string[] = [];
  for (const id of oldConnectionIds) {
    if (!newConnectionIds.has(id)) missing.push(id);
  }
  if (missing.length > 0) {
    throw new AnchorMismatchError(missing);
  }

  return {
    ...sketch,
    parts: sketch.parts.map((p) =>
      p.id === oldPartId ? { ...newPart, id: oldPart.id } : p,
    ),
  };
}
