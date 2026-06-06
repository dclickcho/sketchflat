// Phase 3 — refinement 모듈 단위 테스트.
//
// 합성 입력 4종:
//   (1) classify 임계 — stroke-width / dasharray / 길이 조건별 결과
//   (2) 끊어진 사각형 — 9(b)/9(c) bridge 가 closed face 1개를 만들어내는지
//   (3) V 다트 + 큰 사각형 — PiP 계층화로 다트가 사각형의 자식이 되는지
//   (4) 평행 이중선 — 회귀 기록 (face 수 / role 분포)

import { describe, it, expect } from 'vitest';
import { DEFAULT_TRANSFORM, type Anchor, type Part } from '../src/index';
import { classifyPart, classifyParts } from '../src/refinement/classify';
import { refineSketch } from '../src/refinement';

// ── helpers ─────────────────────────────────────────────────────────────

interface PartOpts {
  id: string;
  points: Array<[number, number]>;
  closed?: boolean;
  strokeWidth?: number;
  dasharray?: number[];
  category?: Part['category'];
  zIndex?: number;
  subpathBreaks?: number[];
  subpathClosed?: boolean[];
}

function makePart(o: PartOpts): Part {
  const anchors: Anchor[] = o.points.map((p, i) => ({
    id: `${o.id}_a${i}`,
    x: p[0],
    y: p[1],
    type: 'edit_point',
    kind: 'corner',
  }));
  const xs = o.points.map((p) => p[0]);
  const ys = o.points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    id: o.id,
    category: o.category ?? 'other',
    svg_paths: [''],
    fill: 'none',
    stroke: '#000000',
    stroke_width: o.strokeWidth ?? 1.2,
    stroke_dasharray: o.dasharray,
    anchors,
    subpath_breaks: o.subpathBreaks,
    subpath_closed: o.subpathClosed ?? [o.closed ?? false],
    bounding_box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    z_index: o.zIndex ?? 0,
    editable: true,
    swappable: true,
    transform: DEFAULT_TRANSFORM,
    metadata: {},
  };
}

// ── (1) classify 임계 ───────────────────────────────────────────────────

describe('classifyPart — 두께/대시/길이 임계', () => {
  it('dasharray 가 비어있지 않으면 무조건 decorative (cls-3 stitch)', () => {
    const p = makePart({
      id: 'stitch',
      points: [[0, 0], [50, 0]],
      strokeWidth: 1.2, // 두꺼워도 dash 면 decorative
      dasharray: [2, 2],
    });
    expect(classifyPart(p)).toBe('decorative');
  });

  it('stroke-width >= 1.0 → structural (cls-1)', () => {
    const p = makePart({ id: 'thick', points: [[0, 0], [10, 0]], strokeWidth: 1.2 });
    expect(classifyPart(p)).toBe('structural');
  });

  it('stroke-width <= 0.3 → decorative (cls-4/5/6)', () => {
    const p = makePart({ id: 'thin', points: [[0, 0], [10, 0]], strokeWidth: 0.25 });
    expect(classifyPart(p)).toBe('decorative');
  });

  it('cls-2 영역 (0.4px) — 길이 < 30px 이면 decorative', () => {
    const p = makePart({ id: 'cls2_short', points: [[0, 0], [10, 0]], strokeWidth: 0.4 });
    expect(classifyPart(p)).toBe('decorative');
  });

  it('cls-2 영역 (0.4px) — 길이 >= 30px 이면 structural', () => {
    const p = makePart({ id: 'cls2_long', points: [[0, 0], [40, 0]], strokeWidth: 0.4 });
    expect(classifyPart(p)).toBe('structural');
  });

  it('classifyParts 는 part_id → role 맵을 반환', () => {
    const parts = [
      makePart({ id: 'a', points: [[0, 0], [10, 0]], strokeWidth: 1.2 }),
      makePart({ id: 'b', points: [[0, 0], [10, 0]], strokeWidth: 0.25 }),
    ];
    const roles = classifyParts(parts);
    expect(roles.get('a')).toBe('structural');
    expect(roles.get('b')).toBe('decorative');
  });
});

// ── (2) 끊어진 사각형 → bridge 가 닫는다 ────────────────────────────────

describe('refineSketch — 끊어진 사각형 9(c) bridge', () => {
  it('두 갈라진 line segment 가 9(b) bridge 로 닫혀 face 1개 생성', () => {
    // Arrow 는 같은 외곽선이라도 종종 둘 이상 path 로 끊어 출력. 두 끝점이 서로 다른
    // sub-path 에 속하므로 9(b) 가 매치한다 (BRIDGE_RADIUS=1.5px).
    //
    // p1: (0, 0) → (40, 0) → (40, 40)        — 끝점 (0,0), (40,40)
    // p2: (40, 41) → (0, 40) → (-1, 0)        — 끝점 (40,41), (-1, 0)
    // (40,40)↔(40,41) 거리 1.0, (0,0)↔(-1,0) 거리 1.0 — 둘 다 9(b) 매치.
    const p1 = makePart({
      id: 'p1',
      points: [[0, 0], [40, 0], [40, 40]],
      strokeWidth: 1.2,
    });
    const p2 = makePart({
      id: 'p2',
      points: [[40, 41], [0, 40], [-1, 0]],
      strokeWidth: 1.2,
    });
    const result = refineSketch([p1, p2]);
    expect(result.faces.length).toBe(1);
    const face = result.faces[0]!;
    expect(face.signed_area).toBeGreaterThan(0);
    expect(face.bounding_box.width).toBeGreaterThan(35);
    expect(face.bounding_box.height).toBeGreaterThan(35);
    // 두 bridge 가 (각 갭마다 하나씩) 마킹되어 있어야 한다.
    expect(face.bridge_segments.length).toBeGreaterThanOrEqual(1);
  });

  it('이미 닫힌 사각형은 bridge 없이 face 1개', () => {
    const closed = makePart({
      id: 'sq_closed',
      points: [
        [0, 0],
        [40, 0],
        [40, 40],
        [0, 40],
      ],
      closed: true,
      strokeWidth: 1.2,
    });
    const result = refineSketch([closed]);
    expect(result.faces.length).toBe(1);
    expect(result.faces[0]!.bridge_segments.length).toBe(0);
  });
});

// ── (3) V 다트 + 사각형 → PiP 종속 ─────────────────────────────────────

describe('refineSketch — PiP 계층화', () => {
  it('큰 사각형 안의 V 다트 (장식) 가 자식으로 종속', () => {
    const body = makePart({
      id: 'body',
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      closed: true,
      strokeWidth: 1.2,
      category: 'body',
    });
    // V 다트: 사각형 한가운데. 짧고 얇아 dasharray 없으면 decorative 가 안 될 수도 — 명시적으로
    // 얇게 (stroke_width 0.25) 만들어 decorative 분류 보장.
    const dart = makePart({
      id: 'dart',
      points: [
        [40, 30],
        [50, 60],
        [60, 30],
      ],
      closed: false,
      strokeWidth: 0.25,
      category: 'other',
      zIndex: 1,
    });
    const result = refineSketch([body, dart]);
    expect(result.faces.length).toBe(1);
    expect(result.roles.get('body')).toBe('structural');
    expect(result.roles.get('dart')).toBe('decorative');

    const dartOut = result.parts.find((p) => p.id === 'dart')!;
    expect(dartOut.parent_face_id).toBe(result.faces[0]!.id);
    expect(result.orphanCount).toBe(0);
  });

  it('face 밖에 있는 장식은 root (orphan)', () => {
    const body = makePart({
      id: 'body',
      points: [
        [0, 0],
        [40, 0],
        [40, 40],
        [0, 40],
      ],
      closed: true,
      strokeWidth: 1.2,
    });
    const stray = makePart({
      id: 'stray',
      points: [
        [200, 200],
        [210, 210],
      ],
      strokeWidth: 0.25,
    });
    const result = refineSketch([body, stray]);
    expect(result.faces.length).toBe(1);
    const strayOut = result.parts.find((p) => p.id === 'stray')!;
    expect(strayOut.parent_face_id).toBeUndefined();
    expect(result.orphanCount).toBe(1);
  });

  it('중첩 face — 작은 face 가 부모로 선택', () => {
    const outer = makePart({
      id: 'outer',
      points: [
        [0, 0],
        [200, 0],
        [200, 200],
        [0, 200],
      ],
      closed: true,
      strokeWidth: 1.2,
    });
    const inner = makePart({
      id: 'inner',
      points: [
        [50, 50],
        [150, 50],
        [150, 150],
        [50, 150],
      ],
      closed: true,
      strokeWidth: 1.2,
    });
    const dart = makePart({
      id: 'dart',
      points: [
        [80, 80],
        [120, 120],
      ],
      strokeWidth: 0.25,
    });
    const result = refineSketch([outer, inner, dart]);
    // outer + inner 모두 face 로 추출.
    expect(result.faces.length).toBeGreaterThanOrEqual(2);
    // 가장 작은 face = inner.
    const dartOut = result.parts.find((p) => p.id === 'dart')!;
    const innerFace = result.faces.find((f) => f.bounding_box.width < 110);
    expect(innerFace).toBeDefined();
    expect(dartOut.parent_face_id).toBe(innerFace!.id);
  });
});

// ── (4) 평행 이중선 — 회귀 기록 ────────────────────────────────────────

describe('refineSketch — 평행 이중선 (회귀 기록)', () => {
  it('두 평행 구조선 (점선 아님) 은 face 가 만들어지지 않음 (open paths)', () => {
    // 2 개의 평행 직선만 있으면 폐곡선이 안 만들어진다. 이는 "사전 머지 없음" 정책 (§4.2) 의
    // 기대 동작 — 회귀 기록.
    const top = makePart({
      id: 'top',
      points: [[0, 0], [100, 0]],
      strokeWidth: 1.2,
    });
    const bottom = makePart({
      id: 'bottom',
      points: [[0, 4], [100, 4]],
      strokeWidth: 1.2,
    });
    const result = refineSketch([top, bottom]);
    // 끝점들이 서로 떨어져 있어 9(b)/9(c) 도 매치되지 않음 (BRIDGE_RADIUS=1.5px).
    expect(result.faces.length).toBe(0);
  });

  it('점선 (dasharray) 평행 이중선은 둘 다 decorative — face 영향 없음', () => {
    const stitch1 = makePart({
      id: 'stitch1',
      points: [[0, 0], [100, 0]],
      strokeWidth: 0.3,
      dasharray: [2, 2],
    });
    const stitch2 = makePart({
      id: 'stitch2',
      points: [[0, 4], [100, 4]],
      strokeWidth: 0.3,
      dasharray: [2, 2],
    });
    const result = refineSketch([stitch1, stitch2]);
    expect(result.roles.get('stitch1')).toBe('decorative');
    expect(result.roles.get('stitch2')).toBe('decorative');
    expect(result.faces.length).toBe(0);
  });
});

// ── (5) Part 구조 보존 ─────────────────────────────────────────────────

describe('refineSketch — Part 보존', () => {
  it('refineSketch 는 입력 anchor 를 mutate 하지 않는다', () => {
    const square = makePart({
      id: 'sq',
      points: [
        [0, 0],
        [40, 0],
        [40, 40],
        [0, 40],
      ],
      closed: true,
      strokeWidth: 1.2,
    });
    const before = JSON.parse(JSON.stringify(square.anchors));
    refineSketch([square]);
    expect(square.anchors).toEqual(before);
  });

  it('출력 parts 는 입력과 같은 길이/순서', () => {
    const a = makePart({ id: 'a', points: [[0, 0], [10, 0]], strokeWidth: 1.2 });
    const b = makePart({ id: 'b', points: [[0, 5], [10, 5]], strokeWidth: 0.25 });
    const c = makePart({ id: 'c', points: [[0, 10], [10, 10]], strokeWidth: 1.2 });
    const result = refineSketch([a, b, c]);
    expect(result.parts.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});
