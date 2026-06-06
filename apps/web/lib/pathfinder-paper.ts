// paper.js 기반 Pathfinder 헬퍼.
//
// polygon-clipping 은 입력을 직선 폴리곤으로 평탄화한 뒤 boolean 을 수행하므로 결과의 cubic
// 핸들이 모두 사라진다. 패스파인더 Divide 후 곡선이 직선 corner 점들로 깨지는 원인.
// paper.js 는 cubic 베지어를 그대로 다루는 boolean 을 제공하므로, divide 만 paper 위에서
// 처리해 핸들 정보를 잃지 않게 한다.

import paper from 'paper/dist/paper-core';
import {
  type Anchor,
  type Part,
  type Transform,
  DEFAULT_TRANSFORM,
} from '@sketchflat/svg-schema';

// paper-core 는 PaperScope 셋업이 끝난 상태에서만 boolean 연산이 동작.
// 모듈 로드 시점이 아니라 첫 호출 시점에 lazy 셋업해 SSR 평가에서 안전.
let _scopeReady = false;
function ensureScope(): void {
  if (_scopeReady) return;
  paper.setup(new paper.Size(1, 1));
  _scopeReady = true;
}

function localToWorld(p: { x: number; y: number }, t: Transform): { x: number; y: number } {
  const rad = (t.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const sx = p.x * t.scaleX;
  const sy = p.y * t.scaleY;
  return { x: sx * c - sy * s + t.x, y: sx * s + sy * c + t.y };
}

// Part → paper.PathItem (Path 또는 CompoundPath). transform 을 적용해 world 좌표로 베이크.
// cubic 핸들은 paper.Segment.handleIn/handleOut (segment.point 기준 *상대* 좌표) 으로 옮긴다.
// closed=false subpath 도 그대로 open path 로 둔다 (knife 모드 등에서 활용).
export function partToPaperItem(part: Part): paper.PathItem | null {
  ensureScope();
  const t = part.transform ?? DEFAULT_TRANSFORM;
  const breaks = part.subpath_breaks ?? [];
  const closedFlags = part.subpath_closed ?? [];
  const subpathCount = breaks.length + 1;

  const subpaths: paper.Path[] = [];
  for (let s = 0; s < subpathCount; s++) {
    const start = s === 0 ? 0 : breaks[s - 1]!;
    const end = s === subpathCount - 1 ? part.anchors.length : breaks[s]!;
    if (end - start < 2) continue;

    const path = new paper.Path({ insert: false });
    for (let i = start; i < end; i++) {
      const a = part.anchors[i]!;
      const w = localToWorld({ x: a.x, y: a.y }, t);
      const seg = new paper.Segment(new paper.Point(w.x, w.y));
      if (a.handle_in) {
        const wh = localToWorld(a.handle_in, t);
        seg.handleIn = new paper.Point(wh.x - w.x, wh.y - w.y);
      }
      if (a.handle_out) {
        const wh = localToWorld(a.handle_out, t);
        seg.handleOut = new paper.Point(wh.x - w.x, wh.y - w.y);
      }
      path.add(seg);
    }
    path.closed = closedFlags[s] ?? false;
    subpaths.push(path);
  }
  if (subpaths.length === 0) return null;
  if (subpaths.length === 1) return subpaths[0]!;
  const cp = new paper.CompoundPath({ insert: false });
  for (const sub of subpaths) cp.addChild(sub);
  return cp;
}

// 펜으로 그린 열린 path 를 칼로 사용. 두께 거의 0 인 띠 closed Path 로 변환해
// region 에서 subtract 하면 region 이 칼선을 따라 두 조각으로 나뉜다.
// 곡선 핸들이 있어도 그대로 살아남도록 — 띠는 양 옆으로 normal offset 을 줘 만들고,
// 각 segment 의 handle 도 같은 방향으로 회전 변환해 그대로 옮긴다.
//
// pad 는 양 끝점을 진행방향으로 늘려 region 경계를 *완전히* 가로지르게 보장.
// halfWidth 는 sub-pixel — 슬릿이 시각적으로 보이지 않을 만큼 얇게.
export function knifeToPaperItem(part: Part, pad: number, halfWidth: number): paper.PathItem | null {
  ensureScope();
  const t = part.transform ?? DEFAULT_TRANSFORM;
  const breaks = part.subpath_breaks ?? [];
  const subpathCount = breaks.length + 1;

  const ribbons: paper.Path[] = [];
  for (let s = 0; s < subpathCount; s++) {
    const start = s === 0 ? 0 : breaks[s - 1]!;
    const end = s === subpathCount - 1 ? part.anchors.length : breaks[s]!;
    if (end - start < 2) continue;

    // world 좌표 + 핸들 (절대) 로 변환.
    type WorldAnchor = { x: number; y: number; hin?: { x: number; y: number }; hout?: { x: number; y: number } };
    const wpts: WorldAnchor[] = [];
    for (let i = start; i < end; i++) {
      const a = part.anchors[i]!;
      const w = localToWorld({ x: a.x, y: a.y }, t);
      wpts.push({
        x: w.x,
        y: w.y,
        hin: a.handle_in ? localToWorld(a.handle_in, t) : undefined,
        hout: a.handle_out ? localToWorld(a.handle_out, t) : undefined,
      });
    }

    // 양 끝점을 직선 진행방향으로 pad 만큼 연장.
    if (wpts.length >= 2) {
      const a0 = wpts[0]!;
      const a1 = wpts[1]!;
      const dx0 = a0.x - a1.x, dy0 = a0.y - a1.y;
      const len0 = Math.hypot(dx0, dy0);
      if (len0 > 1e-9) {
        a0.x += (dx0 / len0) * pad;
        a0.y += (dy0 / len0) * pad;
        // 첫 점의 handle_out 은 의미 있게 유지 (그대로). handle_in 은 자르고 시작이라 무관.
      }
      const an = wpts[wpts.length - 1]!;
      const am = wpts[wpts.length - 2]!;
      const dx1 = an.x - am.x, dy1 = an.y - am.y;
      const len1 = Math.hypot(dx1, dy1);
      if (len1 > 1e-9) {
        an.x += (dx1 / len1) * pad;
        an.y += (dy1 / len1) * pad;
      }
    }

    // 각 점에서 진행방향에 수직인 normal 벡터를 구해 양옆으로 halfWidth offset.
    // normal 은 직전·직후 segment 방향의 평균 (곡선이라도 점 위치 기준 1차 근사로 충분 — halfWidth 가 sub-pixel).
    const offsets: { nx: number; ny: number }[] = wpts.map((_, i) => {
      const prev = wpts[i - 1] ?? wpts[i]!;
      const next = wpts[i + 1] ?? wpts[i]!;
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return { nx: 0, ny: 0 };
      return { nx: -dy / len, ny: dx / len };
    });

    // forward path: 각 점을 +normal*halfWidth 만큼 이동, handle 도 같이 평행이동.
    // backward path: 역순으로 -normal*halfWidth.
    const path = new paper.Path({ insert: false });
    for (let i = 0; i < wpts.length; i++) {
      const w = wpts[i]!;
      const o = offsets[i]!;
      const px = w.x + o.nx * halfWidth;
      const py = w.y + o.ny * halfWidth;
      const seg = new paper.Segment(new paper.Point(px, py));
      if (w.hin) {
        seg.handleIn = new paper.Point(w.hin.x - w.x, w.hin.y - w.y);
      }
      if (w.hout) {
        seg.handleOut = new paper.Point(w.hout.x - w.x, w.hout.y - w.y);
      }
      path.add(seg);
    }
    for (let i = wpts.length - 1; i >= 0; i--) {
      const w = wpts[i]!;
      const o = offsets[i]!;
      const px = w.x - o.nx * halfWidth;
      const py = w.y - o.ny * halfWidth;
      const seg = new paper.Segment(new paper.Point(px, py));
      // 역방향이라 handle_in/out 의 역할이 뒤바뀐다.
      if (w.hout) {
        seg.handleIn = new paper.Point(w.hout.x - w.x, w.hout.y - w.y);
      }
      if (w.hin) {
        seg.handleOut = new paper.Point(w.hin.x - w.x, w.hin.y - w.y);
      }
      path.add(seg);
    }
    path.closed = true;
    ribbons.push(path);
  }
  if (ribbons.length === 0) return null;
  if (ribbons.length === 1) return ribbons[0]!;
  // 다중 서브패스 칼은 unite 로 한 덩어리.
  let merged: paper.PathItem = ribbons[0]!;
  for (let i = 1; i < ribbons.length; i++) {
    merged = merged.unite(ribbons[i]!, { insert: false });
  }
  return merged;
}

// PathItem 의 children 을 outer + holes 로 묶기. boolean 결과 CompoundPath 는
// disjoint 한 여러 영역과 그 hole 들이 한 CompoundPath 안에 섞여 있을 수 있다.
// "각 child 의 bounds 중심이 다른 child 안에 들어가는가" 만으로 단순 grouping —
// nested hole-in-hole 같은 복잡한 case 는 제외하지만, 우리 워크플로(2D 도형 분할) 에서는 충분.
function groupOuterAndHoles(children: paper.Path[]): paper.Path[][] {
  const sorted = [...children].sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  const groups: { outer: paper.Path; holes: paper.Path[] }[] = [];
  for (const c of sorted) {
    let placed = false;
    for (const g of groups) {
      if (g.outer.contains(c.bounds.center)) {
        g.holes.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ outer: c, holes: [] });
  }
  return groups.map((g) => [g.outer, ...g.holes]);
}

// PathItem (boolean 결과) 을 piece 단위로 쪼갠다. 한 piece = 한 outer subpath + N hole subpath.
// 비어있는 결과 (segments 0, children 0, 또는 area ≈ 0) 는 빈 배열 반환.
export function paperItemToPieces(item: paper.PathItem): paper.Path[][] {
  if (item instanceof paper.CompoundPath) {
    const children = (item.children ?? []).filter((c): c is paper.Path => c instanceof paper.Path && c.segments.length > 0);
    if (children.length === 0) return [];
    return groupOuterAndHoles(children);
  }
  if (item instanceof paper.Path) {
    if (item.segments.length === 0) return [];
    return [[item]];
  }
  return [];
}

// 한 piece (outer + holes) → Anchor 기반 새 Part. handle 정보 그대로 보존.
// template 의 스타일/카테고리/이름을 승계. id/transform/bbox 는 새로 채운다.
export function pieceToPart(
  piece: paper.Path[],
  template: Part,
  zIndex: number,
  mode: 'unite' | 'divide' | 'subtract' | 'intersect' | 'exclude',
  pieceIndex: number,
): Part | null {
  const anchors: Anchor[] = [];
  const breaks: number[] = [];
  const closedFlags: boolean[] = [];

  for (let si = 0; si < piece.length; si++) {
    const subpath = piece[si]!;
    if (subpath.segments.length < 2) continue;
    if (anchors.length > 0) breaks.push(anchors.length);

    const subTag = `pf_${mode}_${pieceIndex}_${si}`;
    for (let i = 0; i < subpath.segments.length; i++) {
      const seg = subpath.segments[i]!;
      const ax = seg.point.x;
      const ay = seg.point.y;
      const hin = seg.handleIn;
      const hout = seg.handleOut;
      // paper.Segment.handleIn/Out 은 segment.point 기준 *상대*. 우리 Anchor 는 절대 좌표.
      // 핸들이 (0,0) 또는 ε 이내면 직선 — 우리 스키마에서 handle_in/out 부재로 표현.
      const hasHin = hin && (Math.abs(hin.x) > 1e-9 || Math.abs(hin.y) > 1e-9);
      const hasHout = hout && (Math.abs(hout.x) > 1e-9 || Math.abs(hout.y) > 1e-9);
      const a: Anchor = {
        id: `anchor_${subTag}_${i}`,
        x: ax,
        y: ay,
        type: 'edit_point',
        kind: 'corner',
        handle_in: hasHin ? { x: ax + hin!.x, y: ay + hin!.y } : undefined,
        handle_out: hasHout ? { x: ax + hout!.x, y: ay + hout!.y } : undefined,
      };
      anchors.push(a);
    }
    closedFlags.push(subpath.closed);
  }

  if (anchors.length < 2) return null;

  // bounding_box: anchors + handles 를 모두 포괄. transform 은 identity 로 베이크된 상태.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consume = (p: { x: number; y: number }) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  };
  for (const a of anchors) {
    consume({ x: a.x, y: a.y });
    if (a.handle_in) consume(a.handle_in);
    if (a.handle_out) consume(a.handle_out);
  }
  if (!Number.isFinite(minX)) return null;

  const id = `part_${mode}_${Date.now().toString(36)}_${Math.floor(Math.random() * 100000)}_${pieceIndex}`;
  const newPart: Part = {
    id,
    category: template.category,
    subtype: template.subtype,
    svg_paths: [],
    fill: template.fill,
    stroke: template.stroke,
    stroke_width: template.stroke_width,
    stroke_dasharray: template.stroke_dasharray ? [...template.stroke_dasharray] : undefined,
    stroke_linecap: template.stroke_linecap,
    stroke_linejoin: template.stroke_linejoin,
    anchors,
    subpath_breaks: breaks.length > 0 ? breaks : undefined,
    subpath_closed: closedFlags,
    bounding_box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    z_index: zIndex,
    editable: true,
    swappable: true,
    // anchors 는 이미 world 좌표로 베이크. transform 은 identity.
    transform: { ...DEFAULT_TRANSFORM },
    metadata: {},
    visible: template.visible,
    locked: template.locked,
  };
  return newPart;
}

// PathItem 이 의미 있는 영역을 갖는지. boolean 결과가 빈 path 일 수 있어 호출자가 판단 가능.
export function isMeaningful(item: paper.PathItem | null | undefined): boolean {
  if (!item) return false;
  if (item instanceof paper.CompoundPath) {
    const children = item.children ?? [];
    return children.some((c) => c instanceof paper.Path && c.segments.length >= 2);
  }
  if (item instanceof paper.Path) {
    return item.segments.length >= 2;
  }
  return false;
}

// boolean 연산 후 결과를 정리하기 위한 헬퍼. 결과가 본인 또는 입력과 같은 객체일 수 있어
// remove() 호출 책임을 단일 지점으로 모은다 (메모리 누수 방지). 호출자가 결과를 더 이상
// 쓰지 않을 때 호출.
export function disposePaperItem(item: paper.PathItem | null | undefined): void {
  if (!item) return;
  try {
    item.remove();
  } catch {
    // 이미 제거되었거나 detached — 무시.
  }
}
