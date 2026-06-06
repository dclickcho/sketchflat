import { describe, it, expect } from 'vitest';
import { parsePathD } from '../src/path-parser';
import {
  buildArcTable,
  buildPartArcTables,
  pointAtDistance,
  type ArcPoint,
} from '../src/arc-length';
import type { Part } from '../src/parts';

// parsePathD 결과(anchors 등)를 최소 Part 로 감싼다 — buildPartArcTables 는 Part 형태를 받는다.
function toPart(d: string): Part {
  const parsed = parsePathD(d, 'p');
  return {
    id: 'p',
    category: 'other',
    svg_paths: [d],
    fill: 'none',
    stroke: '#000',
    stroke_width: 1,
    anchors: parsed.anchors,
    subpath_breaks: parsed.subpath_breaks,
    subpath_closed: parsed.subpath_closed,
    bounding_box: { x: 0, y: 0, width: 0, height: 0 },
    z_index: 0,
    editable: true,
    swappable: true,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    metadata: {},
  } as Part;
}

describe('buildArcTable', () => {
  it('직선 폴리라인의 전체 길이와 누적 거리', () => {
    const pts: ArcPoint[] = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ];
    const t = buildArcTable(pts);
    expect(t.total).toBeCloseTo(7, 6); // 3 + 4
    expect(t.cumulative).toEqual([0, 3, 7]);
  });

  it('중복점(길이 0 세그먼트)은 제거된다', () => {
    const t = buildArcTable([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(t.points).toHaveLength(2);
    expect(t.total).toBeCloseTo(10, 6);
  });
});

describe('pointAtDistance', () => {
  const table = buildArcTable([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ]);

  it('중간 지점과 접선 각도 (수평 구간)', () => {
    const s = pointAtDistance(table, 5);
    expect(s.x).toBeCloseTo(5, 6);
    expect(s.y).toBeCloseTo(0, 6);
    expect(s.angle).toBeCloseTo(0, 6);
  });

  it('두 번째 구간 (수직, 각도 π/2)', () => {
    const s = pointAtDistance(table, 15);
    expect(s.x).toBeCloseTo(10, 6);
    expect(s.y).toBeCloseTo(5, 6);
    expect(s.angle).toBeCloseTo(Math.PI / 2, 6);
  });

  it('범위를 벗어난 거리는 클램핑된다', () => {
    const start = pointAtDistance(table, -5);
    expect(start.x).toBeCloseTo(0, 6);
    expect(start.y).toBeCloseTo(0, 6);
    const end = pointAtDistance(table, 999);
    expect(end.x).toBeCloseTo(10, 6);
    expect(end.y).toBeCloseTo(10, 6);
  });
});

describe('buildPartArcTables', () => {
  it('직선 두 구간 path 의 총 길이', () => {
    const tables = buildPartArcTables(toPart('M 0 0 L 10 0 L 10 10'));
    expect(tables).toHaveLength(1);
    expect(tables[0]!.total).toBeCloseTo(20, 6);
  });

  it('큐빅 곡선도 폴리라인으로 평탄화되어 양수 길이를 가진다', () => {
    const tables = buildPartArcTables(toPart('M 0 0 C 10 10 20 10 30 0'));
    expect(tables).toHaveLength(1);
    // 곡선이라 현(30)보다 길다.
    expect(tables[0]!.total).toBeGreaterThan(30);
    expect(tables[0]!.points.length).toBeGreaterThan(2);
  });
});
