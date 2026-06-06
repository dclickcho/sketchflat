// Phase B — 평면그래프 face traversal.
//
// 구조선의 평탄화 폴리라인 + Phase A 의 bridge segment 들을 평면그래프로 묶고, 좌회전
// 우선 traversal 로 face 를 추출한다. *원본 anchor 는 한 번도 만지지 않으며* 출력 face 는
// (partId, anchorIndex) 시퀀스 + bridge segment 시퀀스 + 식별용 평탄화 폴리곤만 들고 있다.
//
// 알고리즘 (논문 그림 10 변형):
//  1. 모든 평탄화 점 + bridge 끝점 → spatial hash 로 mergeRadius 안의 점은 같은 vertex.
//  2. sub-path 인접점/bridge 끝점 사이마다 양방향 half-edge 추가.
//  3. 각 vertex 의 outgoing half-edge 를 angle (atan2) CCW 정렬.
//  4. half-edge h 의 face 후속자 = h.to 에서 twin(h) 직전 (CCW 한 칸 뒤) 의 outgoing.
//  5. 시작 half-edge 부터 후속자를 따라가 cycle 구성. 셰이스 공식 S < 0 (시계방향) 폐기.
//  6. 분기 없는 단순 closed sub-path 는 그래프 traversal 우회 → 그대로 face 등록.

import type { Face, FaceAnchorRef, FaceBridgeSegment } from '../parts';
import type { FlatPoint } from './flatten';
import type { BridgeSegment, PartFlat, PhaseAResult } from './rules';

export interface FaceDecomposeOptions {
  /** vertex 스냅 반경. 기본은 phaseA.mergeRadius */
  mergeRadius?: number;
  /** face id prefix. 기본 'face' */
  idPrefix?: string;
}

export function decomposeFaces(
  structural: PartFlat[],
  phaseA: PhaseAResult,
  opts: FaceDecomposeOptions = {},
): Face[] {
  const mergeRadius = opts.mergeRadius ?? phaseA.mergeRadius;
  const idPrefix = opts.idPrefix ?? 'face';
  const faces: Face[] = [];
  let faceCounter = 0;

  const isDiscarded = (partId: string, sIdx: number) =>
    phaseA.discardedSubpaths.some((d) => d.partId === partId && d.subpathIndex === sIdx);

  // ── (a) 단순 closed sub-path 우회 ─────────────────────────────────────────────
  // "단순" = sub-path 가 closed=true 이고, 그 점들이 다른 sub-path/bridge 와 vertex 를
  // 공유하지 않음. 공유 여부는 그래프 빌드 후 알 수 있으므로, 일단 "닫힌 sub-path 후보"
  // 를 표시해 두고 그래프 빌드 후 분기점이 없으면 face 로 직접 등록.
  // (구현 단순화: 일단 모든 sub-path 를 그래프에 넣은 뒤, 닫힌 sub-path 의 모든 vertex 가
  //  해당 sub-path 한 개와만 인접 (degree==2) 이면 단순 closed 로 본다.)

  // ── (b) 평면그래프 빌드 ───────────────────────────────────────────────────────
  const graph = new GraphBuilder(mergeRadius);

  // 각 sub-path 의 vertex 시퀀스를 기록 (단순 closed 판정용).
  type SubpathRecord = {
    part: PartFlat;
    subpathIndex: number;
    vertexIds: number[];
    points: FlatPoint[];
    closed: boolean;
  };
  const subpathRecords: SubpathRecord[] = [];

  for (const part of structural) {
    for (let s = 0; s < part.subpaths.length; s++) {
      if (isDiscarded(part.part.id, s)) continue;
      const sp = part.subpaths[s]!;
      if (sp.points.length < 2) continue;
      const vertexIds: number[] = [];
      for (const p of sp.points) {
        vertexIds.push(graph.addVertex(p.x, p.y));
      }
      // 닫힌 sub-path 면 마지막→처음 edge 가 평탄화 단계에서 이미 들어가 있음
      // (flatten.ts 가 closing segment 도 평탄화). points[last] 가 첫 점과 거의 일치하면
      // 마지막 vertex 를 첫 vertex 로 통합.
      if (sp.closed && vertexIds.length >= 2) {
        const first = vertexIds[0]!;
        const last = vertexIds[vertexIds.length - 1]!;
        if (first !== last) {
          const fp = sp.points[0]!;
          const lp = sp.points[sp.points.length - 1]!;
          if (Math.hypot(fp.x - lp.x, fp.y - lp.y) <= mergeRadius) {
            graph.unify(first, last);
            vertexIds[vertexIds.length - 1] = first;
          }
        }
      }
      // edges
      for (let i = 0; i < vertexIds.length - 1; i++) {
        const v0 = vertexIds[i]!;
        const v1 = vertexIds[i + 1]!;
        if (v0 === v1) continue; // self-loop 방지.
        graph.addEdge(v0, v1, {
          kind: 'path',
          partId: part.part.id,
          subpathIndex: s,
          fromPoint: sp.points[i]!,
          toPoint: sp.points[i + 1]!,
        });
      }
      subpathRecords.push({
        part,
        subpathIndex: s,
        vertexIds,
        points: sp.points,
        closed: sp.closed,
      });
    }
  }

  // bridge 추가.
  for (const bridge of phaseA.bridges) {
    const v0 = graph.addVertex(bridge.from.x, bridge.from.y);
    const v1 = graph.addVertex(bridge.to.x, bridge.to.y);
    if (v0 === v1) continue;
    graph.addEdge(v0, v1, { kind: 'bridge', bridge });
  }

  graph.finalize();

  // ── (c) closed sub-path → face 직접 등록 ────────────────────────────────────
  // 닫힌 sub-path 는 *vertex 공유 여부와 무관하게* 자체로 face 가 된다. Arrow 가 출력하는
  // 셔츠 SVG 는 몸판 외곽 cls-1 (closed) 이 어깨선·칼라 등 다른 cls-1 path 와 vertex 를
  // 공유 (= degree>=3) 하는 경우가 일반적. 예전 구현은 degree==2 만 우회 등록해서 몸판
  // 전체가 일반 traversal 로 넘어가고, self-intersecting 그래프에서 cycle 이 실패해 face
  // 가 통째로 누락됐다. 닫힌 path 는 path 의 의도가 *그 자체로 폐곡선* 이므로 신뢰한다.
  const consumedHalfEdges = new Set<number>();
  for (const rec of subpathRecords) {
    if (!rec.closed) continue;
    // 단순 closed — 직접 등록. half-edge 들을 consumed 표시.
    const polygon: Array<{ x: number; y: number }> = rec.points.map((p) => ({ x: p.x, y: p.y }));
    const anchorRefs: FaceAnchorRef[] = [];
    for (const p of rec.points) {
      if (p.isAnchor) anchorRefs.push({ part_id: p.partId, anchor_index: p.anchorIndex });
    }
    // 닫힌 face 의 마지막 점이 첫 점과 같다면 중복 anchor 제거.
    if (
      anchorRefs.length >= 2 &&
      anchorRefs[0]!.part_id === anchorRefs[anchorRefs.length - 1]!.part_id &&
      anchorRefs[0]!.anchor_index === anchorRefs[anchorRefs.length - 1]!.anchor_index
    ) {
      anchorRefs.pop();
    }
    const signedArea = shoelace(polygon);
    if (Math.abs(signedArea) < 1e-6) continue; // 축퇴.
    if (signedArea < 0) polygon.reverse(); // 항상 CCW 로 정렬.

    // half-edge 소비 표시 (face traversal 단계에서 중복 추출 방지).
    for (let i = 0; i < rec.vertexIds.length - 1; i++) {
      const a = rec.vertexIds[i]!;
      const b = rec.vertexIds[i + 1]!;
      const h = graph.findHalfEdge(a, b);
      if (h !== null) {
        consumedHalfEdges.add(h);
        const tw = graph.twin(h);
        if (tw !== null) consumedHalfEdges.add(tw);
      }
    }

    faces.push({
      id: `${idPrefix}_${faceCounter++}`,
      anchor_refs: anchorRefs,
      bridge_segments: [],
      flat_polygon: polygon,
      bounding_box: bbox(polygon),
      signed_area: Math.abs(signedArea),
    });
  }

  // ── (d) 일반 face traversal ──────────────────────────────────────────────────
  for (let h = 0; h < graph.halfEdgeCount(); h++) {
    if (consumedHalfEdges.has(h)) continue;
    const cycle = graph.traceFace(h);
    if (!cycle) continue;
    for (const eid of cycle) consumedHalfEdges.add(eid);

    const polygon = cycle.map((eid) => {
      const v = graph.halfEdge(eid).from;
      return { x: graph.vertex(v).x, y: graph.vertex(v).y };
    });
    if (polygon.length < 3) continue;
    const signedArea = shoelace(polygon);
    if (signedArea <= 0) continue; // 외부 face / 시계방향 폐기.

    // anchor refs + bridge segments.
    const anchorRefs: FaceAnchorRef[] = [];
    const bridgeSegs: FaceBridgeSegment[] = [];
    for (const eid of cycle) {
      const he = graph.halfEdge(eid);
      const meta = he.meta;
      if (meta.kind === 'path') {
        const p = meta.fromPoint;
        if (p.isAnchor) {
          anchorRefs.push({ part_id: p.partId, anchor_index: p.anchorIndex });
        }
      } else {
        // bridge — 시작점 anchor 1개를 push 하고 bridge 표시.
        const fromIdx = anchorRefs.length;
        anchorRefs.push({ part_id: meta.bridge.from.partId, anchor_index: meta.bridge.from.anchorIndex });
        const toIdx = anchorRefs.length;
        // to 는 다음 edge 가 push 하지 않을 수도 있으므로 직접 push.
        anchorRefs.push({ part_id: meta.bridge.to.partId, anchor_index: meta.bridge.to.anchorIndex });
        bridgeSegs.push({ from: fromIdx, to: toIdx });
      }
    }

    faces.push({
      id: `${idPrefix}_${faceCounter++}`,
      anchor_refs: anchorRefs,
      bridge_segments: bridgeSegs,
      flat_polygon: polygon,
      bounding_box: bbox(polygon),
      signed_area: signedArea,
    });
  }

  return faces;
}

// ── 평면그래프 빌더 ─────────────────────────────────────────────────────────────

type EdgeMeta =
  | {
      kind: 'path';
      partId: string;
      subpathIndex: number;
      fromPoint: FlatPoint;
      toPoint: FlatPoint;
    }
  | { kind: 'bridge'; bridge: BridgeSegment };

interface Vertex {
  id: number;
  x: number;
  y: number;
  outgoing: number[]; // half-edge ids
}

interface HalfEdge {
  id: number;
  from: number;
  to: number;
  twin: number;
  angle: number;
  meta: EdgeMeta;
}

class GraphBuilder {
  private vertices: Vertex[] = [];
  private halfEdges: HalfEdge[] = [];
  private grid = new Map<string, number[]>();
  private cellSize: number;
  private mergeRadius: number;

  constructor(mergeRadius: number) {
    // cellSize 는 mergeRadius 보다 약간 크게 — 인접 9 셀로 mergeRadius 범위 커버.
    this.cellSize = Math.max(mergeRadius, 1e-3);
    this.mergeRadius = mergeRadius;
  }

  addVertex(x: number, y: number): number {
    // 인접 셀에서 mergeRadius 안의 기존 vertex 찾으면 재사용.
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const r2 = this.mergeRadius * this.mergeRadius;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.grid.get(`${cx + dx},${cy + dy}`);
        if (!bucket) continue;
        for (const vid of bucket) {
          const v = this.vertices[vid]!;
          const ddx = v.x - x;
          const ddy = v.y - y;
          if (ddx * ddx + ddy * ddy <= r2) return vid;
        }
      }
    }
    const id = this.vertices.length;
    this.vertices.push({ id, x, y, outgoing: [] });
    const key = `${cx},${cy}`;
    let bucket = this.grid.get(key);
    if (!bucket) {
      bucket = [];
      this.grid.set(key, bucket);
    }
    bucket.push(id);
    return id;
  }

  unify(keep: number, drop: number): void {
    if (keep === drop) return;
    const dropV = this.vertices[drop];
    const keepV = this.vertices[keep];
    if (!dropV || !keepV) return;
    keepV.outgoing.push(...dropV.outgoing);
    for (const heid of dropV.outgoing) {
      this.halfEdges[heid]!.from = keep;
      const twin = this.halfEdges[this.halfEdges[heid]!.twin]!;
      twin.to = keep;
    }
    dropV.outgoing = [];
  }

  addEdge(v0: number, v1: number, meta: EdgeMeta): void {
    const a = this.vertices[v0]!;
    const b = this.vertices[v1]!;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const idA = this.halfEdges.length;
    const idB = idA + 1;
    this.halfEdges.push({
      id: idA,
      from: v0,
      to: v1,
      twin: idB,
      angle: ang,
      meta,
    });
    // twin 의 meta 는 동일한 path 의 *역방향* segment. fromPoint/toPoint 가 바뀐다.
    let twinMeta: EdgeMeta;
    if (meta.kind === 'path') {
      twinMeta = {
        kind: 'path',
        partId: meta.partId,
        subpathIndex: meta.subpathIndex,
        fromPoint: meta.toPoint,
        toPoint: meta.fromPoint,
      };
    } else {
      twinMeta = {
        kind: 'bridge',
        bridge: {
          from: meta.bridge.to,
          to: meta.bridge.from,
          source: meta.bridge.source,
        },
      };
    }
    this.halfEdges.push({
      id: idB,
      from: v1,
      to: v0,
      twin: idA,
      angle: normalizeAngle(ang + Math.PI),
      meta: twinMeta,
    });
    a.outgoing.push(idA);
    b.outgoing.push(idB);
  }

  finalize(): void {
    for (const v of this.vertices) {
      v.outgoing.sort((a, b) => this.halfEdges[a]!.angle - this.halfEdges[b]!.angle);
    }
  }

  vertex(id: number): Vertex {
    return this.vertices[id]!;
  }
  halfEdge(id: number): HalfEdge {
    return this.halfEdges[id]!;
  }
  twin(id: number): number | null {
    return this.halfEdges[id]?.twin ?? null;
  }
  halfEdgeCount(): number {
    return this.halfEdges.length;
  }
  degree(vid: number): number {
    return this.vertices[vid]?.outgoing.length ?? 0;
  }
  findHalfEdge(from: number, to: number): number | null {
    const v = this.vertices[from];
    if (!v) return null;
    for (const heid of v.outgoing) {
      if (this.halfEdges[heid]!.to === to) return heid;
    }
    return null;
  }

  /**
   * half-edge h 의 face 윤곽 cycle (왼쪽 면) 을 추적.
   * h.to 에서 twin(h) 의 angle 직전 (CCW 한 칸 뒤) 의 outgoing 이 다음 half-edge.
   */
  traceFace(start: number): number[] | null {
    const cycle: number[] = [];
    const seen = new Set<number>();
    let cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      cycle.push(cur);
      const he = this.halfEdges[cur]!;
      const twin = this.halfEdges[he.twin]!;
      const v = this.vertices[he.to]!;
      // outgoing 은 angle CCW 정렬됨. twin (= v 에서 h.from 방향) 의 인덱스 직전이 face 후속자.
      const idx = v.outgoing.indexOf(twin.id);
      if (idx < 0) return null;
      const n = v.outgoing.length;
      const nextIdx = (idx - 1 + n) % n;
      const next = v.outgoing[nextIdx]!;
      if (next === start) return cycle; // cycle 닫힘.
      cur = next;
      if (cycle.length > this.halfEdges.length + 4) return null; // 안전 가드.
    }
    return null;
  }
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

function shoelace(poly: Array<{ x: number; y: number }>): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function bbox(poly: Array<{ x: number; y: number }>) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
