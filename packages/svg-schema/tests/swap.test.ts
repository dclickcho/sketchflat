import { describe, it, expect } from 'vitest';
import { SketchSchema } from '../src/sketch';
import {
  swapPart,
  CategoryMismatchError,
  AnchorMismatchError,
} from '../src/swap';
import type { Part } from '../src/parts';
import { baseSketchInput, validCollarPart } from './fixtures';

describe('swapPart', () => {
  const sketch = SketchSchema.parse(baseSketchInput);

  it('케이스 5: 같은 카테고리(collar→collar) 교체 → 통과', () => {
    const newCollar: Part = {
      ...validCollarPart,
      id: 'part_collar_002',
      subtype: 'puff_collar',
      svg_paths: ['M 0 50 C 50 0 50 0 100 50'],
    };
    const result = swapPart(sketch, validCollarPart.id, newCollar);

    expect(result.parts).toHaveLength(1);
    const swapped = result.parts[0]!;
    expect(swapped.id).toBe(validCollarPart.id);
    expect(swapped.subtype).toBe('puff_collar');
    expect(swapped.svg_paths).toEqual(['M 0 50 C 50 0 50 0 100 50']);
  });

  it('케이스 6: 다른 카테고리(collar→sleeve) 교체 → 실패', () => {
    const sleevePart: Part = {
      ...validCollarPart,
      id: 'part_sleeve_001',
      category: 'sleeve',
    };

    expect(() => swapPart(sketch, validCollarPart.id, sleevePart)).toThrow(
      CategoryMismatchError,
    );
  });

  it('케이스 7: connection anchor ID 불일치 → 실패', () => {
    const badCollar: Part = {
      ...validCollarPart,
      id: 'part_collar_003',
      anchors: [
        { id: 'wrong_anchor', x: 0, y: 50, type: 'connection', kind: 'corner' },
        { id: 'neck_right', x: 100, y: 50, type: 'connection', kind: 'corner' },
      ],
    };

    expect(() => swapPart(sketch, validCollarPart.id, badCollar)).toThrow(
      AnchorMismatchError,
    );
  });
});
