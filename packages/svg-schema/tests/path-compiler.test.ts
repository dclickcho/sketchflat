import { describe, it, expect } from 'vitest';
import { parsePathD } from '../src/path-parser';
import { compileAnchorsToD } from '../src/path-compiler';

// 라운드트립은 문자열 일치가 아니라 "다시 파싱해 동일한 anchor 시퀀스"가 나오는지로 검증.
// fmt(toFixed(3))로 인해 부동소수 미세차는 발생할 수 있으니 toBeCloseTo 사용.
function roundTrip(d: string) {
  const a = parsePathD(d, 'rt');
  const compiled = compileAnchorsToD(a.anchors, a.subpath_breaks, a.subpath_closed);
  const b = parsePathD(compiled, 'rt');
  return { a, b, compiled };
}

function expectAnchorsClose(
  a: ReturnType<typeof parsePathD>,
  b: ReturnType<typeof parsePathD>,
) {
  expect(b.anchors).toHaveLength(a.anchors.length);
  expect(b.subpath_breaks).toEqual(a.subpath_breaks);
  expect(b.subpath_closed).toEqual(a.subpath_closed);
  for (let i = 0; i < a.anchors.length; i++) {
    const aa = a.anchors[i]!;
    const bb = b.anchors[i]!;
    expect(bb.x).toBeCloseTo(aa.x, 2);
    expect(bb.y).toBeCloseTo(aa.y, 2);
    if (aa.handle_in) {
      expect(bb.handle_in!.x).toBeCloseTo(aa.handle_in.x, 2);
      expect(bb.handle_in!.y).toBeCloseTo(aa.handle_in.y, 2);
    } else {
      expect(bb.handle_in).toBeUndefined();
    }
    if (aa.handle_out) {
      expect(bb.handle_out!.x).toBeCloseTo(aa.handle_out.x, 2);
      expect(bb.handle_out!.y).toBeCloseTo(aa.handle_out.y, 2);
    } else {
      expect(bb.handle_out).toBeUndefined();
    }
  }
}

describe('compileAnchorsToD — 기본 직선 라운드트립', () => {
  it('M 0 0 L 100 0', () => {
    const { a, b, compiled } = roundTrip('M 0 0 L 100 0');
    expect(compiled).toBe('M 0 0 L 100 0');
    expectAnchorsClose(a, b);
  });

  it('multi-line 라운드트립', () => {
    const { a, b } = roundTrip('M 0 0 L 100 0 L 100 100 L 0 100');
    expectAnchorsClose(a, b);
  });
});

describe('compileAnchorsToD — cubic 라운드트립', () => {
  it('M 0 0 C 50 0 50 100 100 100', () => {
    const { a, b, compiled } = roundTrip('M 0 0 C 50 0 50 100 100 100');
    expect(compiled).toBe('M 0 0 C 50 0 50 100 100 100');
    expectAnchorsClose(a, b);
  });
});

describe('compileAnchorsToD — closed sub-path', () => {
  it('M 0 0 L 100 0 L 100 100 Z 라운드트립', () => {
    const { a, b, compiled } = roundTrip('M 0 0 L 100 0 L 100 100 Z');
    expect(compiled.endsWith('Z')).toBe(true);
    expectAnchorsClose(a, b);
  });
});

describe('compileAnchorsToD — multi-subpath', () => {
  it('두 sub-path 라운드트립', () => {
    const { a, b, compiled } = roundTrip('M 0 0 L 50 0 M 100 0 L 150 0');
    // 두 개의 M이 결과에 들어가야 함.
    const mCount = (compiled.match(/M /g) ?? []).length;
    expect(mCount).toBe(2);
    expectAnchorsClose(a, b);
  });

  it('일부만 닫힌 multi-subpath 라운드트립', () => {
    const { a, b } = roundTrip('M 0 0 L 1 0 Z M 10 0 L 11 0');
    expect(a.subpath_closed).toEqual([true, false]);
    expectAnchorsClose(a, b);
  });
});

describe('compileAnchorsToD — 빈 입력', () => {
  it('anchors 비었으면 빈 문자열', () => {
    expect(compileAnchorsToD([])).toBe('');
  });
});
