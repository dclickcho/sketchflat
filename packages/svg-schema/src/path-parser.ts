// SVG path `d` 문자열 → anchors + sub-path 메타데이터.
// 외부 의존성 없이 직접 구현. 도식화 SVG는 path 명령이 길어도 cubic/line/arc 비율이
// 적당히 균형 잡혀 있어, 정밀도보다는 라운드트립 안정성이 중요. arc는 cubic으로 분해해
// 저장 — 이후 컴파일러가 단일 cubic 컨벤션으로 다루기 위함.
//
// 트래킹 상태:
//  - currentPoint: 마지막으로 펜이 위치한 절대 좌표 (다음 명령의 시작점).
//  - subpathStart: 현재 sub-path의 M 좌표 (Z를 만나면 다시 여기로 돌아감).
//  - lastCubicC2: 직전 명령이 cubic이었다면 그 두 번째 control point. S(s) 명령의 reflect 기준.
//  - lastQuadC1: 직전 명령이 quadratic이었다면 control point. T(t) 명령의 reflect 기준.

import type { Anchor } from './anchors';

export interface ParsedPath {
  anchors: Anchor[];
  subpath_breaks: number[];
  subpath_closed: boolean[];
}

interface BuilderAnchor {
  x: number;
  y: number;
  handle_in?: { x: number; y: number };
  handle_out?: { x: number; y: number };
}

interface State {
  cur: { x: number; y: number };
  subpathStart: { x: number; y: number };
  lastCubicC2: { x: number; y: number } | null;
  lastQuadC1: { x: number; y: number } | null;
  // 이번 sub-path의 시작 인덱스 (anchors 배열 기준). M을 만날 때 갱신.
  subpathStartIdx: number;
}

// SVG path 토큰화. 명령 문자 1자 또는 부호/지수 포함 숫자 한 개.
const TOKEN_RE = /[MmLlHhVvCcSsQqTtAaZz]|[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?/g;

export function parsePathD(d: string, idPrefix: string): ParsedPath {
  const tokens = d.match(TOKEN_RE) ?? [];
  const anchors: BuilderAnchor[] = [];
  const subpath_breaks: number[] = [];
  const subpath_closed: boolean[] = [];

  const state: State = {
    cur: { x: 0, y: 0 },
    subpathStart: { x: 0, y: 0 },
    lastCubicC2: null,
    lastQuadC1: null,
    subpathStartIdx: 0,
  };

  // 각 sub-path가 닫혔는지 1:1 매핑하기 위해 sub-path 수에 맞춰 false로 push.
  // M을 만날 때 새 sub-path가 시작되므로 그때 push.
  let i = 0;
  let lastCmd = '';
  while (i < tokens.length) {
    const t = tokens[i] ?? '';
    let cmd: string;
    if (/[A-Za-z]/.test(t)) {
      cmd = t;
      i += 1;
    } else {
      // 명령 생략 시 직전 명령 반복. M 직후의 implicit는 L(또는 m 직후 l) 규칙.
      if (!lastCmd) break;
      if (lastCmd === 'M') cmd = 'L';
      else if (lastCmd === 'm') cmd = 'l';
      else cmd = lastCmd;
    }

    switch (cmd) {
      case 'M':
      case 'm': {
        const rel = cmd === 'm';
        const x = readNum(tokens, i++);
        const y = readNum(tokens, i++);
        const ax = rel ? state.cur.x + x : x;
        const ay = rel ? state.cur.y + y : y;
        // 첫 anchor 외에는 break 기록. anchors가 비어있을 땐 첫 sub-path라 break 불필요.
        if (anchors.length > 0) {
          subpath_breaks.push(anchors.length);
          subpath_closed.push(false);
        }
        anchors.push({ x: ax, y: ay });
        state.cur = { x: ax, y: ay };
        state.subpathStart = { x: ax, y: ay };
        state.subpathStartIdx = anchors.length - 1;
        state.lastCubicC2 = null;
        state.lastQuadC1 = null;
        break;
      }
      case 'L':
      case 'l': {
        const rel = cmd === 'l';
        const x = readNum(tokens, i++);
        const y = readNum(tokens, i++);
        const ax = rel ? state.cur.x + x : x;
        const ay = rel ? state.cur.y + y : y;
        anchors.push({ x: ax, y: ay });
        state.cur = { x: ax, y: ay };
        state.lastCubicC2 = null;
        state.lastQuadC1 = null;
        break;
      }
      case 'H':
      case 'h': {
        const rel = cmd === 'h';
        const x = readNum(tokens, i++);
        const ax = rel ? state.cur.x + x : x;
        const ay = state.cur.y;
        anchors.push({ x: ax, y: ay });
        state.cur = { x: ax, y: ay };
        state.lastCubicC2 = null;
        state.lastQuadC1 = null;
        break;
      }
      case 'V':
      case 'v': {
        const rel = cmd === 'v';
        const y = readNum(tokens, i++);
        const ax = state.cur.x;
        const ay = rel ? state.cur.y + y : y;
        anchors.push({ x: ax, y: ay });
        state.cur = { x: ax, y: ay };
        state.lastCubicC2 = null;
        state.lastQuadC1 = null;
        break;
      }
      case 'C':
      case 'c': {
        const rel = cmd === 'c';
        const x1 = readNum(tokens, i++);
        const y1 = readNum(tokens, i++);
        const x2 = readNum(tokens, i++);
        const y2 = readNum(tokens, i++);
        const x = readNum(tokens, i++);
        const y = readNum(tokens, i++);
        const c1 = abs(rel, state.cur, x1, y1);
        const c2 = abs(rel, state.cur, x2, y2);
        const end = abs(rel, state.cur, x, y);
        // 직전 anchor에 handle_out 부여. 새 anchor에 handle_in. 양쪽 다 절대좌표.
        lastAnchor(anchors).handle_out = c1;
        anchors.push({ x: end.x, y: end.y, handle_in: c2 });
        state.cur = end;
        state.lastCubicC2 = c2;
        state.lastQuadC1 = null;
        break;
      }
      case 'S':
      case 's': {
        const rel = cmd === 's';
        const x2 = readNum(tokens, i++);
        const y2 = readNum(tokens, i++);
        const x = readNum(tokens, i++);
        const y = readNum(tokens, i++);
        // 첫 control은 직전 cubic의 C2를 현재 점 기준 reflect. 직전이 cubic 아니면 cur 그대로.
        const c1 = state.lastCubicC2
          ? { x: 2 * state.cur.x - state.lastCubicC2.x, y: 2 * state.cur.y - state.lastCubicC2.y }
          : { x: state.cur.x, y: state.cur.y };
        const c2 = abs(rel, state.cur, x2, y2);
        const end = abs(rel, state.cur, x, y);
        lastAnchor(anchors).handle_out = c1;
        anchors.push({ x: end.x, y: end.y, handle_in: c2 });
        state.cur = end;
        state.lastCubicC2 = c2;
        state.lastQuadC1 = null;
        break;
      }
      case 'Q':
      case 'q': {
        const rel = cmd === 'q';
        const x1 = readNum(tokens, i++);
        const y1 = readNum(tokens, i++);
        const x = readNum(tokens, i++);
        const y = readNum(tokens, i++);
        const qc = abs(rel, state.cur, x1, y1);
        const end = abs(rel, state.cur, x, y);
        // Quadratic → cubic: c1 = start + 2/3 (qc - start), c2 = end + 2/3 (qc - end).
        const c1 = qToC(state.cur, qc);
        const c2 = qToC(end, qc);
        lastAnchor(anchors).handle_out = c1;
        anchors.push({ x: end.x, y: end.y, handle_in: c2 });
        state.cur = end;
        state.lastCubicC2 = null;
        state.lastQuadC1 = qc;
        break;
      }
      case 'T':
      case 't': {
        const rel = cmd === 't';
        const x = readNum(tokens, i++);
        const y = readNum(tokens, i++);
        // 직전 quadratic의 control을 cur 기준 reflect. 직전이 quad 아니면 cur 그대로.
        const qc = state.lastQuadC1
          ? { x: 2 * state.cur.x - state.lastQuadC1.x, y: 2 * state.cur.y - state.lastQuadC1.y }
          : { x: state.cur.x, y: state.cur.y };
        const end = abs(rel, state.cur, x, y);
        const c1 = qToC(state.cur, qc);
        const c2 = qToC(end, qc);
        lastAnchor(anchors).handle_out = c1;
        anchors.push({ x: end.x, y: end.y, handle_in: c2 });
        state.cur = end;
        state.lastCubicC2 = null;
        state.lastQuadC1 = qc;
        break;
      }
      case 'A':
      case 'a': {
        const rel = cmd === 'a';
        const rx = readNum(tokens, i++);
        const ry = readNum(tokens, i++);
        const phi = readNum(tokens, i++);
        const largeArc = readNum(tokens, i++) !== 0;
        const sweep = readNum(tokens, i++) !== 0;
        const x = readNum(tokens, i++);
        const y = readNum(tokens, i++);
        const end = abs(rel, state.cur, x, y);
        // arc → 여러 cubic. 각 cubic마다 anchor 한 개씩 추가.
        const segs = arcToCubicSegments(state.cur.x, state.cur.y, rx, ry, phi, largeArc, sweep, end.x, end.y);
        for (const seg of segs) {
          lastAnchor(anchors).handle_out = seg.c1;
          anchors.push({ x: seg.end.x, y: seg.end.y, handle_in: seg.c2 });
          state.cur = seg.end;
        }
        const lastSeg = segs[segs.length - 1];
        state.lastCubicC2 = lastSeg ? lastSeg.c2 : null;
        state.lastQuadC1 = null;
        break;
      }
      case 'Z':
      case 'z': {
        // 현재 sub-path 닫힘. subpath_closed의 마지막 칸을 true로.
        // sub-path는 첫 M에서 push되지 않았으므로 (anchors.length===0이었을 때) 길이가
        // sub-path 수보다 1 작을 수 있다. 그땐 첫 sub-path가 닫힘 → push true.
        const subpathCount = subpath_breaks.length + 1;
        while (subpath_closed.length < subpathCount) subpath_closed.push(false);
        subpath_closed[subpathCount - 1] = true;
        // Z 후 currentPoint는 sub-path 시작점으로 복귀.
        state.cur = { x: state.subpathStart.x, y: state.subpathStart.y };
        state.lastCubicC2 = null;
        state.lastQuadC1 = null;
        break;
      }
      default:
        // 알 수 없는 명령은 건너뜀 — 무한 루프 방지를 위해 i를 진행.
        i += 1;
        break;
    }

    lastCmd = cmd;
  }

  // anchors가 비어있으면 sub-path도 없음.
  if (anchors.length === 0) {
    return { anchors: [], subpath_breaks: [], subpath_closed: [] };
  }

  // subpath_closed 길이를 sub-path 수와 맞춤 (Z 없이 끝난 sub-path는 false).
  const subpathCount = subpath_breaks.length + 1;
  while (subpath_closed.length < subpathCount) subpath_closed.push(false);

  // 결정적 ID 부여 + zod 스키마에 맞는 type/kind 채우기.
  const finalAnchors: Anchor[] = anchors.map((a, idx) => ({
    id: `${idPrefix}_a${idx}`,
    x: a.x,
    y: a.y,
    type: 'edit_point',
    kind: 'corner',
    handle_in: a.handle_in,
    handle_out: a.handle_out,
  }));

  return { anchors: finalAnchors, subpath_breaks, subpath_closed };
}

function readNum(tokens: string[], i: number): number {
  // 토큰이 부족하면 0으로 폴백 (잘못된 path여도 무한 루프는 피함).
  return Number(tokens[i] ?? 0);
}

// 마지막 anchor 가져오기 헬퍼. anchors가 비어있는 상태로 cubic 등이 들어올 일은 없지만
// noUncheckedIndexedAccess 하에서 타입을 단순화하기 위함 (M이 항상 선행한다는 invariant).
function lastAnchor(arr: BuilderAnchor[]): BuilderAnchor {
  const a = arr[arr.length - 1];
  if (!a) throw new Error('parsePathD: anchors 비어있는 상태에서 곡선/직선 명령');
  return a;
}

function abs(
  rel: boolean,
  cur: { x: number; y: number },
  x: number,
  y: number,
): { x: number; y: number } {
  return rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
}

// Quadratic control → cubic 두 control 중 하나. qToC(start, qc) = start + 2/3 (qc - start).
function qToC(p: { x: number; y: number }, qc: { x: number; y: number }) {
  return {
    x: p.x + (2 / 3) * (qc.x - p.x),
    y: p.y + (2 / 3) * (qc.y - p.y),
  };
}

// 표준 arc → cubic 분해. W3C SVG 1.1 implementation notes (F.6.5) 참고.
// 1) endpoint parameterization → center parameterization (cx, cy, theta1, dtheta).
// 2) dtheta를 90도 이하 조각으로 분할.
// 3) 각 조각을 cubic으로 근사 (alpha = 4/3 * tan(dtheta/4)).
export interface ArcSegment {
  c1: { x: number; y: number };
  c2: { x: number; y: number };
  end: { x: number; y: number };
}

export function arcToCubicSegments(
  x1: number,
  y1: number,
  rx0: number,
  ry0: number,
  phiDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): ArcSegment[] {
  // 시작==끝이면 그릴 게 없음 (SVG 스펙).
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rx0);
  let ry = Math.abs(ry0);
  // r==0이면 직선 — single cubic with degenerate handles로 처리.
  if (rx === 0 || ry === 0) {
    return [{ c1: { x: x1, y: y1 }, c2: { x: x2, y: y2 }, end: { x: x2, y: y2 } }];
  }
  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // 1단계: 회전 보정한 좌표계에서 중점 계산.
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // 반지름이 너무 작으면 스케일 업 (SVG 스펙 F.6.6).
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;

  let factor = (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / (rx2 * y1p2 + ry2 * x1p2);
  if (factor < 0) factor = 0; // 부동소수 오차 방어.
  factor = Math.sqrt(factor);
  if (largeArc === sweep) factor = -factor;

  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  // 2단계: theta1, dtheta 계산.
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  else if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

  // 3단계: 90도 단위로 분할.
  const segCount = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)));
  const delta = dtheta / segCount;
  const alpha = (4 / 3) * Math.tan(delta / 4);

  const segments: ArcSegment[] = [];
  let curTheta = theta1;
  let prev = pointOnEllipse(cx, cy, rx, ry, cosPhi, sinPhi, curTheta);
  for (let k = 0; k < segCount; k++) {
    const nextTheta = curTheta + delta;
    const next = pointOnEllipse(cx, cy, rx, ry, cosPhi, sinPhi, nextTheta);
    const tan1 = tangentOnEllipse(rx, ry, cosPhi, sinPhi, curTheta);
    const tan2 = tangentOnEllipse(rx, ry, cosPhi, sinPhi, nextTheta);
    const c1 = { x: prev.x + alpha * tan1.x, y: prev.y + alpha * tan1.y };
    const c2 = { x: next.x - alpha * tan2.x, y: next.y - alpha * tan2.y };
    segments.push({ c1, c2, end: next });
    curTheta = nextTheta;
    prev = next;
  }
  return segments;
}

function angle(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
  let r = Math.acos(Math.max(-1, Math.min(1, dot / len)));
  if (ux * vy - uy * vx < 0) r = -r;
  return r;
}

function pointOnEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  cosPhi: number,
  sinPhi: number,
  t: number,
) {
  const x = rx * Math.cos(t);
  const y = ry * Math.sin(t);
  return { x: cosPhi * x - sinPhi * y + cx, y: sinPhi * x + cosPhi * y + cy };
}

function tangentOnEllipse(
  rx: number,
  ry: number,
  cosPhi: number,
  sinPhi: number,
  t: number,
) {
  const dx = -rx * Math.sin(t);
  const dy = ry * Math.cos(t);
  return { x: cosPhi * dx - sinPhi * dy, y: sinPhi * dx + cosPhi * dy };
}
