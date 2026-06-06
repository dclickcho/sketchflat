import { describe, it, expect } from 'vitest';
import { parsePathD } from '../src/path-parser';

describe('parsePathD — 기본 직선', () => {
  it('M + L: 2 anchors, handle 없음', () => {
    const r = parsePathD('M 0 0 L 100 0', 'p');
    expect(r.anchors).toHaveLength(2);
    const a0 = r.anchors[0]!;
    const a1 = r.anchors[1]!;
    expect(a0).toMatchObject({ x: 0, y: 0 });
    expect(a1).toMatchObject({ x: 100, y: 0 });
    expect(a0.handle_in).toBeUndefined();
    expect(a0.handle_out).toBeUndefined();
    expect(a1.handle_in).toBeUndefined();
    expect(a1.handle_out).toBeUndefined();
    expect(r.subpath_breaks).toEqual([]);
    expect(r.subpath_closed).toEqual([false]);
  });

  it('id는 결정적 패턴', () => {
    const r = parsePathD('M 0 0 L 1 1 L 2 2', 'part_x_3');
    expect(r.anchors.map((a) => a.id)).toEqual([
      'part_x_3_a0',
      'part_x_3_a1',
      'part_x_3_a2',
    ]);
  });

  it('H/V: 수평/수직 직선 anchor 3개', () => {
    const r = parsePathD('M 0 0 H 100 V 50', 'p');
    expect(r.anchors.map((a) => [a.x, a.y])).toEqual([
      [0, 0],
      [100, 0],
      [100, 50],
    ]);
  });
});

describe('parsePathD — cubic', () => {
  it('M + C: 2 anchors, handle_out & handle_in 채워짐', () => {
    const r = parsePathD('M 0 0 C 50 0 50 100 100 100', 'p');
    expect(r.anchors).toHaveLength(2);
    const a0 = r.anchors[0]!;
    const a1 = r.anchors[1]!;
    expect(a0.handle_out).toEqual({ x: 50, y: 0 });
    expect(a1.handle_in).toEqual({ x: 50, y: 100 });
    expect(a1).toMatchObject({ x: 100, y: 100 });
  });

  it('소문자 c: 절대좌표로 변환', () => {
    const r = parsePathD('M 0 0 c 50 0 50 100 100 100', 'p');
    const a0 = r.anchors[0]!;
    const a1 = r.anchors[1]!;
    expect(a0.handle_out).toEqual({ x: 50, y: 0 });
    expect(a1.handle_in).toEqual({ x: 50, y: 100 });
    expect(a1).toMatchObject({ x: 100, y: 100 });
  });
});

describe('parsePathD — quadratic → cubic 변환', () => {
  it('Q를 cubic으로 변환: 2/3 공식', () => {
    const r = parsePathD('M 0 0 Q 50 100 100 0', 'p');
    expect(r.anchors).toHaveLength(2);
    const out = r.anchors[0]!.handle_out!;
    const inn = r.anchors[1]!.handle_in!;
    expect(out.x).toBeCloseTo(33.333, 2);
    expect(out.y).toBeCloseTo(66.667, 2);
    expect(inn.x).toBeCloseTo(66.667, 2);
    expect(inn.y).toBeCloseTo(66.667, 2);
  });
});

describe('parsePathD — sub-path & close', () => {
  it('Z: subpath_closed[0] === true', () => {
    const r = parsePathD('M 0 0 L 100 0 Z', 'p');
    expect(r.subpath_closed).toEqual([true]);
  });

  it('두 sub-path: breaks=[2]', () => {
    const r = parsePathD('M 0 0 L 50 0 M 100 0 L 150 0', 'p');
    expect(r.anchors).toHaveLength(4);
    expect(r.subpath_breaks).toEqual([2]);
    expect(r.subpath_closed).toEqual([false, false]);
  });

  it('각 sub-path가 독립적으로 닫힘 표시', () => {
    const r = parsePathD('M 0 0 L 1 0 Z M 10 0 L 11 0', 'p');
    expect(r.subpath_breaks).toEqual([2]);
    expect(r.subpath_closed).toEqual([true, false]);
  });
});
