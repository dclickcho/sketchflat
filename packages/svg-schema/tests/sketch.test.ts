import { describe, it, expect } from 'vitest';
import { SketchSchema } from '../src/sketch';
import { baseSketchInput, validCollarPart } from './fixtures';

describe('SketchSchema 검증', () => {
  it('케이스 1: parts 있음, raw_svg 없음 → 통과', () => {
    const result = SketchSchema.safeParse(baseSketchInput);
    expect(result.success).toBe(true);
  });

  it('케이스 2: parts 비었음, raw_svg 있음 → 통과', () => {
    const input = {
      ...baseSketchInput,
      parts: [],
      raw_svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" /></svg>',
    };
    const result = SketchSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('케이스 3: parts 비었음, raw_svg 없음 → 실패 (cross-field invariant)', () => {
    const input = { ...baseSketchInput, parts: [] };
    const result = SketchSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' | ');
      expect(messages).toContain('raw_svg');
    }
  });

  it('케이스 4: 알 수 없는 카테고리 → 실패', () => {
    const input = {
      ...baseSketchInput,
      parts: [{ ...validCollarPart, category: 'invalid_category' }],
    };
    const result = SketchSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
