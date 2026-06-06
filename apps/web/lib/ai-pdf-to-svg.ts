// Adobe Illustrator(.ai) / PDF -> SVG 변환기 (클라이언트 전용)
//
// WHY: 최신 .ai 파일은 PDF 호환 컨테이너라서 동일한 PDF 파싱 경로로 처리한다.
// pdfjs-dist v5 의 getOperatorList() 결과를 직접 순회해 벡터 path 만 추출하고,
// fill/stroke 색·선폭·점선·그라디언트·패턴까지 보존한 SVG 문자열로 재조립한다.
// (text/image/raster 무시)
//
// pdfjs v5 핵심 사실 (node_modules/pdfjs-dist/build/pdf.mjs / pdf.worker.mjs 에서 직접 확인):
//  - 경로는 OPS.constructPath(=91) 하나로 들어온다. args = [paintOp, [Float32Array|null], minMax|null]
//    즉 v5 에서는 paint 종류(fill/stroke/...)가 constructPath args[0] 에 "이미 포함"되어 있어
//    별도의 후속 paint op 을 기다릴 필요가 없다.
//  - path 데이터는 DrawOPS 플랫 배열: moveTo=0(+2), lineTo=1(+2), curveTo=2(+6, 항상 풀 큐빅),
//    quadraticCurveTo=3(+4), closePath=4. curveTo2/3 은 워커가 미리 풀 큐빅으로 펼쳐준다.
//  - 단순 색(Gray/CMYK/RGB)은 워커가 setFillRGBColor/setStrokeRGBColor + "#rrggbb" 로 정규화.
//  - 패턴/그라데이션은 setFillColorN/setStrokeColorN 으로 떨어지고 args 는
//      ["Shading", objId, matrix]  (Shading 패턴 — 축형/방사형/메시)
//      ["TilingPattern", color, opListIR, matrix, bbox, xstep, ystep, paintType, tilingType, needsIso]
//    중 하나. Shading 의 실제 IR 은 page.objs.get(objId) 로 비동기 수신.
//  - shadingFill(sh 연산자)도 별도로 들어오며 args = [objId]. Shading IR 만 채워주면 된다.
//  - Shading IR 종류:
//      ["RadialAxial", "axial"|"radial", bbox, colorStops, p0, p1, r0, r1]
//      ["Mesh", shadingType, posData, colData, vertexCount, bounds, bbox, background]
//      ["Dummy"]

import type {
  OPS as OPSType,
  PDFPageProxy,
} from 'pdfjs-dist';

// DrawOPS 는 v5 내부 enum 이라 public 타입에 없으므로 로컬 상수로 고정한다.
// (출처: pdf.mjs 의 const DrawOPS)
const DRAW_MOVE_TO = 0;
const DRAW_LINE_TO = 1;
const DRAW_CURVE_TO = 2;
const DRAW_QUADRATIC_CURVE_TO = 3;
const DRAW_CLOSE_PATH = 4;

// 2x3 아핀 행렬 [a,b,c,d,e,f]. PDF/canvas 컨벤션:
//   x' = a*x + c*y + e,  y' = b*x + d*y + f
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

// Paint 는 fill/stroke 모두에 쓰이는 색 소스. Shading 패턴은 비동기로 IR 을 받아야 하므로
// 1차 스캔에서는 objId 만 기억하고, IR 도착 후 2차 패스에서 실제 그라디언트로 풀어준다.
type Paint =
  | { kind: 'none' }
  | { kind: 'color'; value: string }
  | { kind: 'shading'; objId: string; matrix: Matrix | null }
  | { kind: 'tiling'; ir: unknown[] };

interface GraphicsState {
  ctm: Matrix;
  fill: Paint;
  stroke: Paint;
  lineWidth: number; // PDF user space 기준 선폭
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
  dashArray: number[]; // PDF user space 단위. [] = 실선
  dashPhase: number;
  // 직전 endPath(=n) 의 device-공간 d 문자열. 일러스트레이터가 그라디언트 원을
  // (path → W → n → sh) 패턴으로 출력하는 걸 받기 위해, sh 핸들러가 이 값을 clip 영역으로
  // 사용한다. save/restore 와 함께 push/pop 되므로 q 블록 안에서 정의된 clip 이 Q 후에 새지 않음.
  lastEndPathD?: string;
}

// newCTM = CTM × opMatrix (점은 opMatrix 가 먼저 적용된 뒤 CTM 이 적용되도록 합성)
// WHY: PDF 의 cm 연산자는 현재 CTM 앞에 새 행렬을 곱한다(우측 곱). 즉 좌표는
// 안쪽(op)부터 바깥(기존 CTM) 순으로 변환되어야 한다.
function multiply(ctm: Matrix, m: Matrix): Matrix {
  const [a, b, c, d, e, f] = ctm;
  const [a2, b2, c2, d2, e2, f2] = m;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

// 점 (x,y) 를 행렬로 변환.
function apply(m: Matrix, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

// 컴팩트한 SVG 를 위해 좌표를 소수 2자리로 반올림(불필요한 -0 제거).
function r(n: number): number {
  const v = Math.round(n * 100) / 100;
  return v === 0 ? 0 : v;
}

// lineCap 코드(0/1/2) -> SVG 값
function mapCap(code: number): GraphicsState['lineCap'] {
  return code === 1 ? 'round' : code === 2 ? 'square' : 'butt';
}

// lineJoin 코드(0/1/2) -> SVG 값
function mapJoin(code: number): GraphicsState['lineJoin'] {
  return code === 1 ? 'round' : code === 2 ? 'bevel' : 'miter';
}

// XML 속성에 안전하게 넣기 위한 최소 escape.
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// DrawOPS 플랫 배열 -> 좌표계 m 의 SVG path "d" 문자열.
function buildPathD(data: Float32Array | number[] | null, m: Matrix): string {
  if (!data || data.length === 0) return '';
  const parts: string[] = [];
  let i = 0;
  const n = data.length;
  while (i < n) {
    const op = data[i++];
    switch (op) {
      case DRAW_MOVE_TO: {
        const [x, y] = apply(m, data[i++], data[i++]);
        parts.push(`M${r(x)} ${r(y)}`);
        break;
      }
      case DRAW_LINE_TO: {
        const [x, y] = apply(m, data[i++], data[i++]);
        parts.push(`L${r(x)} ${r(y)}`);
        break;
      }
      case DRAW_CURVE_TO: {
        const [x1, y1] = apply(m, data[i++], data[i++]);
        const [x2, y2] = apply(m, data[i++], data[i++]);
        const [x, y] = apply(m, data[i++], data[i++]);
        parts.push(`C${r(x1)} ${r(y1)} ${r(x2)} ${r(y2)} ${r(x)} ${r(y)}`);
        break;
      }
      case DRAW_QUADRATIC_CURVE_TO: {
        const [x1, y1] = apply(m, data[i++], data[i++]);
        const [x, y] = apply(m, data[i++], data[i++]);
        parts.push(`Q${r(x1)} ${r(y1)} ${r(x)} ${r(y)}`);
        break;
      }
      case DRAW_CLOSE_PATH:
        parts.push('Z');
        break;
      default:
        return parts.join('');
    }
  }
  return parts.join('');
}

// setFillColorN/setStrokeColorN args 를 Paint 로 정규화.
// args 형태:
//   ["Shading", objId, matrix]               — Shading 패턴
//   ["TilingPattern", color, opListIR, ...]  — 타일링 패턴 (IR 인라인)
//   기타                                     — 알 수 없으니 색 폴백 'none'/'#000'
function parsePatternArgs(args: unknown[]): Paint {
  if (!Array.isArray(args) || args.length === 0) return { kind: 'none' };
  const tag = args[0];
  if (tag === 'Shading') {
    const objId = typeof args[1] === 'string' ? args[1] : null;
    const matrix = Array.isArray(args[2]) && args[2].length === 6 ? (args[2] as Matrix) : null;
    if (objId) return { kind: 'shading', objId, matrix };
    return { kind: 'none' };
  }
  if (tag === 'TilingPattern') {
    return { kind: 'tiling', ir: args };
  }
  return { kind: 'none' };
}

// Shading 패턴 IR 을 비동기로 받아둔다. getOperatorList() 가 완료된 직후엔
// page.objs 에 도착해 있을 수도/아닐 수도 있으므로 명시적으로 콜백 등록.
async function resolveShadingIR(
  page: PDFPageProxy,
  objId: string,
): Promise<unknown> {
  return new Promise((resolve) => {
    // pdfjs PDFObjects.get(id, cb) 은 id 가 미해결이면 도착 시 cb 호출, 해결돼 있으면 즉시 cb 호출.
    (page.objs as unknown as { get: (id: string, cb: (data: unknown) => void) => void }).get(
      objId,
      resolve,
    );
  });
}

// RGB 16진수로 정규화. "#abc" → "#aabbcc", "#abcdef" 그대로, 길이 어긋나면 null.
function normalizeColor(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  }
  return null;
}

// 색 stop 들의 평균을 단일 RGB 로. Mesh 폴백 등에 사용.
function averageStops(stops: Array<[number, string]>): string {
  if (!stops || stops.length === 0) return '#888888';
  let R = 0, G = 0, B = 0, n = 0;
  for (const [, hex] of stops) {
    const h = normalizeColor(hex);
    if (!h) continue;
    R += parseInt(h.slice(1, 3), 16);
    G += parseInt(h.slice(3, 5), 16);
    B += parseInt(h.slice(5, 7), 16);
    n += 1;
  }
  if (n === 0) return '#888888';
  const to2 = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${to2(R)}${to2(G)}${to2(B)}`;
}

// 그라디언트/패턴 정의 등록기. 같은 IR 을 여러 path 가 참조하면 같은 id 로 묶어
// SVG 의 <defs> 가 비대해지지 않도록 한다.
class DefsRegistry {
  private defs: string[] = [];
  private counter = 0;

  newId(prefix: 'g' | 'p'): string {
    return `${prefix}${this.counter++}`;
  }

  add(xml: string): void {
    this.defs.push(xml);
  }

  // 비어 있으면 <defs> 자체를 생략해서 출력 크기를 줄임.
  render(): string {
    return this.defs.length > 0 ? `<defs>${this.defs.join('')}</defs>` : '';
  }
}

// Shading IR → SVG <linearGradient>|<radialGradient> 등록. id 반환. Mesh 는 평균색을
// 단색으로 등록하지 않고 호출자에게 폴백 색을 알리기 위해 null 반환(+ averageColor 채움).
// deviceBbox: shading dict 의 BBox 를 device 좌표 axis-aligned 사각형으로 환산.
// sh 연산자가 clip 정보 없이 페이지 전체에 깔리지 않도록 호출자가 이 영역만 그릴 수 있게 한다.
function emitShadingDef(
  defs: DefsRegistry,
  ir: unknown,
  ctmAtSet: Matrix,
  patternMatrix: Matrix | null,
): {
  id: string | null;
  fallbackColor?: string;
  deviceBbox?: [number, number, number, number];
} {
  if (!Array.isArray(ir)) return { id: null, fallbackColor: '#888888' };
  const tag = ir[0];

  // 패턴 좌표 → user space: patternMatrix 우선, 없으면 항등. user space → device: ctmAtSet.
  // pdfjs 가 호환되도록 set 시점의 CTM 을 그대로 사용.
  const toDevice: Matrix = multiply(ctmAtSet, patternMatrix ?? IDENTITY);

  // shading dict 의 BBox (ir[2]) 를 device 공간 axis-aligned bbox 로 환산. 회전된
  // 그라디언트에서도 corner-bbox 로 묶기 위해 4 모서리 모두 변환.
  // 일러스트레이터가 BBox 를 안 박는 경우(null 또는 0-area)도 흔하므로, 그 땐 호출자 쪽에서
  // 그라디언트의 axis(axial: p0~p1, radial: cx±r) 로 폴백 bbox 를 만든다.
  const bboxRaw = ir[2] as [number, number, number, number] | null | undefined;
  const cornerBboxToDevice = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): [number, number, number, number] => {
    const corners: Array<[number, number]> = [
      apply(toDevice, x0, y0),
      apply(toDevice, x1, y0),
      apply(toDevice, x1, y1),
      apply(toDevice, x0, y1),
    ];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };

  let deviceBbox: [number, number, number, number] | undefined;
  if (Array.isArray(bboxRaw) && bboxRaw.length === 4 && bboxRaw.every((n) => Number.isFinite(n))) {
    const db = cornerBboxToDevice(bboxRaw[0], bboxRaw[1], bboxRaw[2], bboxRaw[3]);
    if (db[2] - db[0] > 0 && db[3] - db[1] > 0) deviceBbox = db;
  }

  if (tag === 'RadialAxial') {
    const type = ir[1] as 'axial' | 'radial';
    const colorStops = (ir[3] ?? []) as Array<[number, string]>;
    const p0 = ir[4] as [number, number];
    const p1 = ir[5] as [number, number];
    const r0 = (ir[6] as number) ?? 0;
    const r1 = (ir[7] as number) ?? 0;

    // BBox 폴백: shading dict 가 BBox 를 안 박았으면 그라디언트 자체의 도형(axial 은 p0~p1
    // 선분, radial 은 시작/끝 원의 외접 사각형)으로 영역 추정. 일러스트레이터의 작은 버튼
    // 그라디언트는 fill 영역과 axis 영역이 거의 같아 잘 들어맞는다.
    if (!deviceBbox) {
      if (type === 'axial') {
        deviceBbox = cornerBboxToDevice(
          Math.min(p0[0], p1[0]),
          Math.min(p0[1], p1[1]),
          Math.max(p0[0], p1[0]),
          Math.max(p0[1], p1[1]),
        );
      } else {
        deviceBbox = cornerBboxToDevice(
          Math.min(p0[0] - r0, p1[0] - r1),
          Math.min(p0[1] - r0, p1[1] - r1),
          Math.max(p0[0] + r0, p1[0] + r1),
          Math.max(p0[1] + r0, p1[1] + r1),
        );
      }
      if (!(deviceBbox[2] - deviceBbox[0] > 0 && deviceBbox[3] - deviceBbox[1] > 0)) {
        deviceBbox = undefined;
      }
    }

    if (!Array.isArray(colorStops) || colorStops.length === 0) {
      return { id: null, fallbackColor: '#888888', deviceBbox };
    }

    const id = defs.newId('g');
    const stopsXml = colorStops
      .map(([off, color]) => {
        const c = normalizeColor(color) ?? '#000000';
        return `<stop offset="${r(off)}" stop-color="${c}"/>`;
      })
      .join('');

    if (type === 'axial') {
      const [x1, y1] = apply(toDevice, p0[0], p0[1]);
      const [x2, y2] = apply(toDevice, p1[0], p1[1]);
      defs.add(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
          `x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}">${stopsXml}</linearGradient>`,
      );
      return { id, deviceBbox };
    }

    // radial: 시작 원 (p0, r0) / 끝 원 (p1, r1). SVG <radialGradient> 는 fx/fy/cx/cy/r 로 표현.
    // 두 반경의 스케일링은 toDevice 행렬의 평균 배율로 근사.
    const [a, b, c, d] = toDevice;
    const radiusScale = Math.sqrt(Math.abs(a * d - b * c));
    const [fx, fy] = apply(toDevice, p0[0], p0[1]);
    const [cx, cy] = apply(toDevice, p1[0], p1[1]);
    defs.add(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
        `fx="${r(fx)}" fy="${r(fy)}" cx="${r(cx)}" cy="${r(cy)}" ` +
        `r="${r(r1 * radiusScale)}" fr="${r(r0 * radiusScale)}">${stopsXml}</radialGradient>`,
    );
    return { id, deviceBbox };
  }

  if (tag === 'Mesh') {
    // SVG 표준에 그물망 그라디언트가 없다. colData(Uint8) 의 평균을 폴백 색으로.
    const colData = ir[3] as Uint8Array | undefined;
    if (colData && colData.length >= 4) {
      let R = 0, G = 0, B = 0, n = 0;
      for (let i = 0; i + 3 < colData.length; i += 4) {
        R += colData[i];
        G += colData[i + 1];
        B += colData[i + 2];
        n += 1;
      }
      if (n > 0) {
        const to2 = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
        return { id: null, fallbackColor: `#${to2(R)}${to2(G)}${to2(B)}` };
      }
    }
    return { id: null, fallbackColor: '#888888' };
  }

  // Dummy 등은 폴백.
  return { id: null, fallbackColor: '#888888' };
}

// 타일링 패턴 IR → <pattern> + 내부 SVG. 내부 op-list 는 재귀적으로 동일한 추출 로직으로
// 변환하되 그라디언트는 못 다루도록 단색으로만 채운다 (중첩 패턴은 흔치 않고 비용↑).
function emitTilingDef(
  defs: DefsRegistry,
  ir: unknown[],
  ctmAtSet: Matrix,
  shadingIRs: Map<string, unknown>,
): { id: string | null; fallbackColor?: string } {
  // ["TilingPattern", color, opListIR, matrix, bbox, xstep, ystep, paintType, tilingType, needsIso]
  const color = ir[1] as string | null | undefined;
  const innerOpList = ir[2] as { fnArray: number[]; argsArray: unknown[][] } | null;
  const patternMatrix = (ir[3] ?? IDENTITY) as Matrix;
  const bbox = ir[4] as [number, number, number, number] | null;
  const xstep = (ir[5] ?? 0) as number;
  const ystep = (ir[6] ?? 0) as number;

  if (!innerOpList || !bbox || xstep <= 0 || ystep <= 0) {
    return { id: null, fallbackColor: normalizeColor(color) ?? '#888888' };
  }

  // 내부 path 들을 패턴의 자기 좌표계(=bbox 기준)에 그대로 그린다. <pattern> 의
  // patternUnits="userSpaceOnUse" + patternTransform 으로 device 공간 매핑.
  const innerPaths = extractInnerPaths(innerOpList, shadingIRs);
  if (innerPaths.length === 0) {
    return { id: null, fallbackColor: normalizeColor(color) ?? '#888888' };
  }

  // 최종 device 변환: ctmAtSet × patternMatrix. <pattern patternTransform> 으로 노출.
  const t = multiply(ctmAtSet, patternMatrix);
  const id = defs.newId('p');
  const [x0, y0, x1, y1] = bbox;
  const w = x1 - x0;
  const h = y1 - y0;

  defs.add(
    `<pattern id="${id}" patternUnits="userSpaceOnUse" ` +
      `x="${r(x0)}" y="${r(y0)}" width="${r(xstep)}" height="${r(ystep)}" ` +
      `viewBox="${r(x0)} ${r(y0)} ${r(w)} ${r(h)}" ` +
      `patternTransform="matrix(${r(t[0])} ${r(t[1])} ${r(t[2])} ${r(t[3])} ${r(t[4])} ${r(t[5])})">` +
      innerPaths.join('') +
      `</pattern>`,
  );
  return { id };
}

// 내부 (타일링 패턴 안) op-list 를 단색 경로들만 뽑아 SVG 조각 배열로. 그라디언트
// fill 은 colorStops 평균색으로, 알 수 없으면 검정으로 폴백 — 중첩 그라디언트는 표현
// 불가능이라 의도적인 손실.
function extractInnerPaths(
  opList: { fnArray: number[]; argsArray: unknown[][] },
  shadingIRs: Map<string, unknown>,
): string[] {
  // 동기 OPS enum 을 함수 안에서 import 하기는 비효율적이라 호출 측에서 미리 주입하지
  // 않고, 작은 매핑만 만들어 v5 OPS 의 알려진 코드들만 본다.
  // (외곽 walker 와 동일한 분기 — 별도 함수로 분리하지 않은 이유는 state 흐름이
  // 길어서 한 컨테이너에 두는 게 가독성 좋기 때문)
  const out: string[] = [];

  // 외곽 walker 를 재귀적으로 호출하기 위해 동일 함수 핸들 재사용.
  // 내부적으로 동일한 GraphicsState 흐름을 돌리되 shading/tiling 은 단색 폴백.
  const ops: number[] = opList.fnArray;
  const argsAll = opList.argsArray;

  // OPS 코드는 외곽에서 알고 있지만 여기서는 모듈 로딩이 안 된 상태일 수도 있다.
  // 외곽이 캡처해둔 enum 을 globalThis 에 임시 핀했다가 끄는 방식 대신, OPS 를 다시
  // 동적으로 가져오면 안전. 캐시는 모듈 스코프에 둠.
  const O = getOpsSync();
  if (!O) return out;

  let state: GraphicsState = {
    ctm: IDENTITY,
    fill: { kind: 'color', value: '#000000' },
    stroke: { kind: 'color', value: '#000000' },
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    dashArray: [],
    dashPhase: 0,
  };
  const stack: GraphicsState[] = [];

  for (let i = 0; i < ops.length; i++) {
    const fn = ops[i];
    const args = argsAll[i];

    if (fn === O.save) {
      stack.push({ ...state, ctm: [...state.ctm] as Matrix });
      continue;
    }
    if (fn === O.restore) {
      const p = stack.pop();
      if (p) state = p;
      continue;
    }
    if (fn === O.transform) {
      const m = args as unknown as Matrix;
      state.ctm = multiply(state.ctm, [m[0], m[1], m[2], m[3], m[4], m[5]]);
      continue;
    }
    if (fn === O.setLineWidth) { state.lineWidth = args[0] as number; continue; }
    if (fn === O.setLineCap) { state.lineCap = mapCap(args[0] as number); continue; }
    if (fn === O.setLineJoin) { state.lineJoin = mapJoin(args[0] as number); continue; }
    if (fn === O.setDash) {
      const arr = Array.isArray(args[0]) ? (args[0] as number[]) : [];
      const phase = typeof args[1] === 'number' ? (args[1] as number) : 0;
      state.dashArray = arr.filter((n) => typeof n === 'number');
      state.dashPhase = phase;
      continue;
    }
    if (fn === O.setFillRGBColor) {
      state.fill = { kind: 'color', value: (args[0] as string) ?? '#000000' };
      continue;
    }
    if (fn === O.setStrokeRGBColor) {
      state.stroke = { kind: 'color', value: (args[0] as string) ?? '#000000' };
      continue;
    }
    if (fn === O.setFillTransparent) { state.fill = { kind: 'none' }; continue; }
    if (fn === O.setStrokeTransparent) { state.stroke = { kind: 'none' }; continue; }
    if (fn === O.setFillColorN) {
      // 중첩 그라디언트: 폴백 단색. shadingIR 의 첫 stop 색을 끌어다 쓰면 더 자연스러움.
      const p = parsePatternArgs(args);
      state.fill = patternToSolid(p, shadingIRs);
      continue;
    }
    if (fn === O.setStrokeColorN) {
      const p = parsePatternArgs(args);
      state.stroke = patternToSolid(p, shadingIRs);
      continue;
    }
    if (fn === O.constructPath) {
      emitPath(state, args, out, /*defs*/ null, /*shadingIRs*/ shadingIRs, /*allowGradient*/ false);
      continue;
    }
  }

  return out;
}

// 패턴 Paint 를 단색 Paint 로 떨군다. (중첩 패턴/메시 폴백)
function patternToSolid(p: Paint, shadingIRs: Map<string, unknown>): Paint {
  if (p.kind === 'shading') {
    const ir = shadingIRs.get(p.objId);
    if (Array.isArray(ir) && ir[0] === 'RadialAxial') {
      const stops = (ir[3] ?? []) as Array<[number, string]>;
      return { kind: 'color', value: averageStops(stops) };
    }
    return { kind: 'color', value: '#888888' };
  }
  if (p.kind === 'tiling') {
    return { kind: 'color', value: '#888888' };
  }
  return p;
}

// OPS 동기 캐시 — 첫 호출은 외곽 convertPdfToSvg 가 모듈을 import 한 뒤에 채워준다.
let opsCache: typeof OPSType | null = null;
function getOpsSync(): typeof OPSType | null {
  return opsCache;
}

// constructPath 한 건을 SVG 조각으로. defs!=null 이면 그라디언트 def 를 등록하고
// fill="url(#..)" 형태로 출력. allowGradient=false 면 단색 폴백만.
function emitPath(
  state: GraphicsState,
  args: unknown,
  out: string[],
  defs: DefsRegistry | null,
  shadingIRs: Map<string, unknown>,
  allowGradient: boolean,
): void {
  if (!opsCache) return;
  const O = opsCache;
  const a = args as unknown[];
  const paintOp = a[0] as number;
  const inner = a[1] as Array<Float32Array | number[] | null>;
  const pathData = inner?.[0] ?? null;

  const d = buildPathD(pathData, state.ctm);
  if (!d) return;

  // endPath(=n) 는 출력하지 않는다. 단, 일러스트레이터가 그라디언트 원을
  // (path → W → n → sh) 로 내릴 때 그 path 가 clip 영역이므로, 다음 sh 가 사용할 수 있게
  // state 에 기억해둔다. 비-clip 의 빈 n 도 갱신되지만 sh 가 직후에 와야만 쓰이므로 무해.
  if (paintOp === O.endPath) {
    state.lastEndPathD = d;
    return;
  }

  const doFill =
    paintOp === O.fill ||
    paintOp === O.eoFill ||
    paintOp === O.fillStroke ||
    paintOp === O.eoFillStroke ||
    paintOp === O.closeFillStroke ||
    paintOp === O.closeEOFillStroke;
  const doStroke =
    paintOp === O.stroke ||
    paintOp === O.closeStroke ||
    paintOp === O.fillStroke ||
    paintOp === O.eoFillStroke ||
    paintOp === O.closeFillStroke ||
    paintOp === O.closeEOFillStroke;
  const evenOdd =
    paintOp === O.eoFill ||
    paintOp === O.eoFillStroke ||
    paintOp === O.closeEOFillStroke;

  const attrs: string[] = [`d="${d}"`];

  if (doFill) {
    const fillAttr = paintToFillAttr(state.fill, state.ctm, defs, shadingIRs, allowGradient);
    attrs.push(fillAttr);
    if (evenOdd) attrs.push(`fill-rule="evenodd"`);
  } else {
    attrs.push(`fill="none"`);
  }

  if (doStroke) {
    const strokeAttr = paintToStrokeAttr(state.stroke, state.ctm, defs, shadingIRs, allowGradient);
    if (strokeAttr) {
      attrs.push(strokeAttr);
      const [a0, b0, c0, d0] = state.ctm;
      const scale = Math.sqrt(Math.abs(a0 * d0 - b0 * c0));
      const w = state.lineWidth * scale;
      attrs.push(`stroke-width="${r(w) || 1}"`);
      attrs.push(`stroke-linecap="${state.lineCap}"`);
      attrs.push(`stroke-linejoin="${state.lineJoin}"`);
      if (state.dashArray.length > 0) {
        const scaled = state.dashArray.map((v) => r(v * scale)).filter((v) => v > 0);
        if (scaled.length > 0) {
          attrs.push(`stroke-dasharray="${scaled.join(' ')}"`);
          if (state.dashPhase) {
            attrs.push(`stroke-dashoffset="${r(state.dashPhase * scale)}"`);
          }
        }
      }
    } else {
      attrs.push(`stroke="none"`);
    }
  } else {
    attrs.push(`stroke="none"`);
  }

  out.push(`<path ${attrs.join(' ')}/>`);
}

// fill 용 Paint → SVG fill 속성 문자열.
function paintToFillAttr(
  p: Paint,
  ctmAtSet: Matrix,
  defs: DefsRegistry | null,
  shadingIRs: Map<string, unknown>,
  allowGradient: boolean,
): string {
  if (p.kind === 'none') return `fill="none"`;
  if (p.kind === 'color') return `fill="${escapeAttr(p.value)}"`;
  if (!allowGradient || !defs) {
    // 그라디언트 차단 모드 → 평균색 폴백.
    return `fill="${patternToSolid(p, shadingIRs).kind === 'color' ? (patternToSolid(p, shadingIRs) as { value: string }).value : 'none'}"`;
  }
  if (p.kind === 'shading') {
    const ir = shadingIRs.get(p.objId);
    const { id, fallbackColor } = emitShadingDef(defs, ir, ctmAtSet, p.matrix);
    if (id) return `fill="url(#${id})"`;
    return `fill="${fallbackColor ?? '#888888'}"`;
  }
  if (p.kind === 'tiling') {
    const { id, fallbackColor } = emitTilingDef(defs, p.ir, ctmAtSet, shadingIRs);
    if (id) return `fill="url(#${id})"`;
    return `fill="${fallbackColor ?? '#888888'}"`;
  }
  return `fill="none"`;
}

// stroke 용 Paint → SVG stroke 속성 문자열 (none 이면 빈 문자열).
function paintToStrokeAttr(
  p: Paint,
  ctmAtSet: Matrix,
  defs: DefsRegistry | null,
  shadingIRs: Map<string, unknown>,
  allowGradient: boolean,
): string {
  if (p.kind === 'none') return '';
  if (p.kind === 'color') return `stroke="${escapeAttr(p.value)}"`;
  if (!allowGradient || !defs) {
    const solid = patternToSolid(p, shadingIRs);
    return solid.kind === 'color' ? `stroke="${solid.value}"` : '';
  }
  if (p.kind === 'shading') {
    const ir = shadingIRs.get(p.objId);
    const { id, fallbackColor } = emitShadingDef(defs, ir, ctmAtSet, p.matrix);
    if (id) return `stroke="url(#${id})"`;
    return `stroke="${fallbackColor ?? '#000000'}"`;
  }
  if (p.kind === 'tiling') {
    const { id, fallbackColor } = emitTilingDef(defs, p.ir, ctmAtSet, shadingIRs);
    if (id) return `stroke="url(#${id})"`;
    return `stroke="${fallbackColor ?? '#000000'}"`;
  }
  return '';
}

export async function convertPdfToSvg(
  data: ArrayBuffer,
): Promise<{ svg: string; pageCount: number } | null> {
  try {
    const pdfjs = await import('pdfjs-dist');
    const { getDocument, GlobalWorkerOptions, OPS } = pdfjs;

    GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    opsCache = OPS as typeof OPSType;

    const pdf = await getDocument({ data }).promise;
    const pageCount = pdf.numPages;
    const page: PDFPageProxy = await pdf.getPage(1);

    const viewport = page.getViewport({ scale: 1 });
    const W = viewport.width;
    const H = viewport.height;
    const baseCtm = viewport.transform as Matrix;

    const opList = await page.getOperatorList();
    const fnArray = opList.fnArray;
    const argsArray = opList.argsArray;
    const O = OPS as typeof OPSType;

    // === Pass 1 — 참조된 Shading 패턴 objId 들을 모은다. ===
    const referencedObjIds = new Set<string>();
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i];
      if (fn === O.setFillColorN || fn === O.setStrokeColorN) {
        const p = parsePatternArgs(args);
        if (p.kind === 'shading') referencedObjIds.add(p.objId);
      } else if (fn === O.shadingFill) {
        const id = args?.[0];
        if (typeof id === 'string') referencedObjIds.add(id);
      }
    }

    // === Shading IR 비동기 해상 ===
    const shadingIRs = new Map<string, unknown>();
    if (referencedObjIds.size > 0) {
      await Promise.all(
        [...referencedObjIds].map(async (id) => {
          try {
            const ir = await resolveShadingIR(page, id);
            shadingIRs.set(id, ir);
          } catch {
            // 무시 — 폴백 색이 자동으로 적용됨
          }
        }),
      );
    }

    // === Pass 2 — 실제 SVG 추출 ===
    const defs = new DefsRegistry();
    const paths: string[] = [];

    let state: GraphicsState = {
      ctm: baseCtm,
      fill: { kind: 'color', value: '#000000' },
      stroke: { kind: 'color', value: '#000000' },
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      dashArray: [],
      dashPhase: 0,
    };
    const stack: GraphicsState[] = [];

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i] as unknown[];

      switch (fn) {
        case O.save:
          stack.push({ ...state, ctm: [...state.ctm] as Matrix });
          break;
        case O.restore: {
          const popped = stack.pop();
          if (popped) state = popped;
          break;
        }
        case O.transform: {
          const m = args as unknown as Matrix;
          state.ctm = multiply(state.ctm, [m[0], m[1], m[2], m[3], m[4], m[5]]);
          break;
        }
        case O.setLineWidth:
          state.lineWidth = args[0] as number;
          break;
        case O.setLineCap:
          state.lineCap = mapCap(args[0] as number);
          break;
        case O.setLineJoin:
          state.lineJoin = mapJoin(args[0] as number);
          break;
        case O.setDash: {
          const arr = Array.isArray(args[0]) ? (args[0] as number[]) : [];
          const phase = typeof args[1] === 'number' ? (args[1] as number) : 0;
          state.dashArray = arr.filter((n) => typeof n === 'number');
          state.dashPhase = phase;
          break;
        }
        case O.setFillRGBColor:
          state.fill = { kind: 'color', value: (args[0] as string) ?? '#000000' };
          break;
        case O.setStrokeRGBColor:
          state.stroke = { kind: 'color', value: (args[0] as string) ?? '#000000' };
          break;
        case O.setFillTransparent:
          state.fill = { kind: 'none' };
          break;
        case O.setStrokeTransparent:
          state.stroke = { kind: 'none' };
          break;
        case O.setFillColorN:
          state.fill = parsePatternArgs(args);
          break;
        case O.setStrokeColorN:
          state.stroke = parsePatternArgs(args);
          break;

        case O.shadingFill: {
          // sh 연산자: 현재 clip 영역을 shading 으로 채운다.
          // 1순위: 일러스트레이터 패턴 (path → W → n → sh) 의 직전 endPath path 가 clip 영역
          //        과 일치하므로 그 path 로 채운다. 원 fill=그라디언트가 정확한 원 모양으로 보존.
          // 2순위: shading dict 의 BBox (또는 axis 폴백) 로 만든 사각형. clip path 가 없을 때.
          // 둘 다 없으면 출력 생략 — 페이지 전체에 그라디언트를 깔아 도식화를 덮어버리는 회귀 방지.
          const objId = args[0];
          if (typeof objId !== 'string') break;
          const ir = shadingIRs.get(objId);
          const { id, fallbackColor, deviceBbox } = emitShadingDef(defs, ir, state.ctm, null);
          const fill = id ? `url(#${id})` : (fallbackColor ?? '#888888');
          const clipD = state.lastEndPathD;
          if (clipD) {
            paths.push(`<path d="${clipD}" fill="${escapeAttr(fill)}" stroke="none"/>`);
            state.lastEndPathD = undefined; // consume — 한 clip 은 한 sh 에만 매칭.
            break;
          }
          if (!deviceBbox) break;
          const [bx0, by0, bx1, by1] = deviceBbox;
          const bw = bx1 - bx0;
          const bh = by1 - by0;
          if (!(bw > 0 && bh > 0)) break;
          paths.push(
            `<rect x="${r(bx0)}" y="${r(by0)}" width="${r(bw)}" height="${r(bh)}" ` +
              `fill="${escapeAttr(fill)}" stroke="none"/>`,
          );
          break;
        }

        case O.constructPath:
          emitPath(state, args, paths, defs, shadingIRs, true);
          break;

        default:
          break;
      }
    }

    if (paths.length === 0) return null;

    const wR = r(W);
    const hR = r(H);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${wR} ${hR}" width="${wR}" height="${hR}">` +
      defs.render() +
      paths.join('') +
      `</svg>`;

    return { svg, pageCount };
  } catch {
    return null;
  }
}
