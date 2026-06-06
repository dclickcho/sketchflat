// raw_svg 통짜 SVG 문자열을 Sketch.parts 배열로 흡수하기 위한 클라이언트 변환기.
// Phase 1 — 부품 카테고리 분리는 아직 못 함 (Track B). 모든 도형은 'other' 카테고리로
// 들어가고, 사용자가 에디터에서 선택/이동/스타일 변경할 수 있는 단위가 되는 게 목표.
//
// 처리 대상: <path>, <line>, <rect>, <circle>, <ellipse>, <polygon>, <polyline>.
// 각 도형은 SVG path `d` 문자열로 변환해 Konva.Path가 그대로 그릴 수 있도록 통일.
//
// Arrow(QuiverAI)가 내려주는 SVG는 보통 <style>의 .cls-N CSS 클래스로 stroke·dasharray를
// 정의하고 path엔 class 속성만 박는다. 그래서 단순 attribute 조회만으로는 stroke-width가
// 다 fallback되고 점선 정보가 전부 소실됨. 아래에서 <style> 텍스트를 정규식으로 파싱해
// 클래스 → 프로퍼티 맵을 빌드한 뒤 readStyle에서 fallback chain의 한 단계로 사용.
//
// 그룹(<g>) 처리: v6 워커는 부위별 외곽선·디테일을 `<g id="part-body" data-label="body">`
// 같은 시맨틱 그룹으로 묶어 내려준다. 도형마다 조상 <g> 체인을 거슬러 올라가 의미있는
// 그룹만 추출(`data-label` 또는 비-자동 id) → part.group_id + result.groupNames /
// groupParents 로 시드한다. v6 내부 파티셔닝용 `<g class="region" id="region-N">` 은
// 사용자에게 의미가 없으므로 투명(transparent) 그룹으로 건너뛴다.
//
// 의도적으로 빠진 것: <text>, <image>, <use>, <g> transform 누적, <defs> 참조,
// 복합 셀렉터(`tag.cls`, `cls1.cls2`), @media/@import, !important.

import type {
  Anchor,
  Part,
  PartCategory,
  PartFill,
  LinearGradientFill,
  RadialGradientFill,
  PatternFill,
  StrokeLinecap,
  StrokeLinejoin,
} from '@sketchflat/svg-schema';
import { DEFAULT_TRANSFORM, parsePathD } from '@sketchflat/svg-schema';

const SHAPE_TAGS = new Set([
  'path',
  'line',
  'rect',
  'circle',
  'ellipse',
  'polygon',
  'polyline',
]);

const LINECAPS = new Set<StrokeLinecap>(['butt', 'round', 'square']);
const LINEJOINS = new Set<StrokeLinejoin>(['miter', 'round', 'bevel']);

type ClassRules = Map<string, Record<string, string>>;

// <defs> 에서 뽑아낸 그라디언트/패턴 정의. id → PartFill (linear/radial/pattern).
// 패스의 fill="url(#id)" 가 이 맵을 통해 구조화된 fill 로 환원된다.
type DefsMap = Map<string, LinearGradientFill | RadialGradientFill | PatternFill>;

export interface ParsedSvgResult {
  parts: Part[];
  canvas: { width: number; height: number };
  /** group_id → 표시 라벨. `<g data-label="X">` 가 있으면 X, 없으면 id. */
  groupNames: Record<string, string>;
  /** child group_id → parent group_id. 최상위 그룹은 키에서 빠진다. */
  groupParents: Record<string, string>;
}

/** 도형 부모 체인을 walking 하며 추출한, 의미있는 <g> 한 조각. id 는 group_id 로 쓰인다. */
interface GroupNode {
  id: string;
  label: string;
}

/** v6 내부 파티셔닝용 wrapper (`<g class="region" id="region-N">`) 는 사용자에게 의미가
 *  없으므로 트리에서 투명 처리한다. data-label 도 없고 id 도 region-N 패턴이라 잘 식별됨. */
function isTransparentGroup(g: Element): boolean {
  const id = g.getAttribute('id') ?? '';
  const cls = (g.getAttribute('class') ?? '').split(/\s+/);
  return cls.includes('region') && /^region-/i.test(id);
}

/** 도형 el 의 조상 <g> 체인을 [최내부 … 최외부] 순서로 반환.
 *  - data-label 또는 id 가 있는 <g> 만 채택 (Illustrator 의 무명 wrapper 는 무시).
 *  - isTransparentGroup 통과한 <g> 도 건너뜀. */
function collectGroupChain(el: Element): GroupNode[] {
  const chain: GroupNode[] = [];
  let cur: Element | null = el.parentElement;
  while (cur && cur.nodeName.toLowerCase() !== 'svg') {
    if (cur.nodeName.toLowerCase() === 'g' && !isTransparentGroup(cur)) {
      const dataLabel = cur.getAttribute('data-label');
      const idAttr = cur.getAttribute('id');
      if (dataLabel || idAttr) {
        // id 가 없으면 data-label 로 합성 — 같은 라벨끼리 한 그룹으로 묶이도록.
        const id = idAttr ?? `g_${dataLabel}`;
        const label = dataLabel ?? idAttr ?? id;
        chain.push({ id, label });
      }
    }
    cur = cur.parentElement;
  }
  return chain;
}

/**
 * raw_svg 문자열 → Part[] + canvas 크기.
 * 파싱 실패 시 parts: [] 반환 (호출자가 raw_svg 폴백을 유지하도록).
 */
export function parseRawSvgToParts(rawSvg: string): ParsedSvgResult | null {
  if (typeof DOMParser === 'undefined') return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return null;

  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return null;

  const canvas = inferCanvasSize(root);
  const classRules = parseStyleSheet(root);
  const defsMap = parseDefs(root);
  const parts: Part[] = [];
  const groupNames: Record<string, string> = {};
  const groupParents: Record<string, string> = {};
  let zIndex = 0;
  let idCounter = 0;

  // SVG 안의 모든 도형을 DOM 순서대로 순회. <defs> 자손은 그라디언트/패턴 정의의
  // 일부이므로 도형으로 흡수하면 안 됨 — defs 안의 path 가 부품으로 잘못 등록되면
  // 캔버스에 그림자처럼 따라 그려진다.
  const walker = doc.createTreeWalker(root, /* SHOW_ELEMENT */ 1);
  let cur: Node | null = walker.currentNode;
  while (cur) {
    if (
      cur instanceof Element &&
      SHAPE_TAGS.has(cur.nodeName.toLowerCase()) &&
      !isInsideDefs(cur)
    ) {
      const part = elementToPart(cur, idCounter, zIndex, classRules, defsMap);
      if (part) {
        // 그룹 체인 ([innermost … outermost]) 흡수. 최내부 = part.group_id.
        // 그룹 메타는 같은 id 가 여러 도형에서 다시 보이므로 first-write-wins 로 머지.
        const chain = collectGroupChain(cur);
        if (chain.length > 0) {
          part.group_id = chain[0]!.id;
          for (let i = 0; i < chain.length; i += 1) {
            const node = chain[i]!;
            if (groupNames[node.id] === undefined) {
              groupNames[node.id] = node.label;
            }
            const parent = chain[i + 1];
            if (parent && groupParents[node.id] === undefined) {
              groupParents[node.id] = parent.id;
            }
          }
        }
        parts.push(part);
        idCounter += 1;
        zIndex += 1;
      }
    }
    cur = walker.nextNode();
  }

  return { parts, canvas, groupNames, groupParents };
}

// 도형 노드가 <defs> 의 후손인지 확인. defs 안의 path 는 그라디언트/패턴 등록의
// 일부지 실제 도형이 아니므로 Part 로 흡수해선 안 된다.
function isInsideDefs(el: Element): boolean {
  let cur: Element | null = el.parentElement;
  while (cur) {
    if (cur.nodeName.toLowerCase() === 'defs') return true;
    cur = cur.parentElement;
  }
  return false;
}

function inferCanvasSize(root: Element): { width: number; height: number } {
  const widthAttr = root.getAttribute('width');
  const heightAttr = root.getAttribute('height');
  const viewBox = root.getAttribute('viewBox');

  const w = parseLength(widthAttr);
  const h = parseLength(heightAttr);
  if (w !== null && h !== null && w > 0 && h > 0) return { width: w, height: h };

  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const vbW = parts[2];
      const vbH = parts[3];
      if (vbW > 0 && vbH > 0) return { width: vbW, height: vbH };
    }
  }
  return { width: 800, height: 1000 };
}

// `<style>` 태그 모두에서 `.className { prop: val; ... }` 규칙을 추출.
// 같은 클래스가 여러 번 정의되면 뒤에 나온 규칙이 앞을 덮어씀.
function parseStyleSheet(root: Element): ClassRules {
  const rules: ClassRules = new Map();
  const styles = root.querySelectorAll('style');
  // 단일 클래스 셀렉터만 — `.cls-N { ... }`. tag.cls / cls1.cls2 같은 복합은 무시.
  const RULE_RE = /\.([a-zA-Z_][\w-]*)\s*\{([^}]*)\}/g;

  styles.forEach((style) => {
    const text = style.textContent ?? '';
    let m: RegExpExecArray | null;
    while ((m = RULE_RE.exec(text)) !== null) {
      const cls = m[1];
      const body = m[2];
      const props: Record<string, string> = {};
      for (const decl of body.split(';')) {
        const idx = decl.indexOf(':');
        if (idx <= 0) continue;
        const k = decl.slice(0, idx).trim().toLowerCase();
        const v = decl.slice(idx + 1).trim();
        if (k && v) props[k] = v;
      }
      const existing = rules.get(cls) ?? {};
      rules.set(cls, { ...existing, ...props });
    }
  });
  return rules;
}

function elementToPart(
  el: Element,
  index: number,
  zIndex: number,
  classRules: ClassRules,
  defsMap: DefsMap,
): Part | null {
  const d = elementToPathD(el);
  if (!d) return null;

  // SVG 스펙: fill 미지정 시 기본 'black', stroke 미지정 시 기본 'none'.
  // 도식화는 거의 항상 stroke-only라 fill 기본도 'none'으로 두는 게 안전 — 명시적
  // fill을 가진 도형은 클래스 룰/속성으로 잡힌다 (예: 배경 rect의 #FCFCFB).
  // .ai/PDF 출처 SVG 는 `fill="url(#g0)"` 처럼 defs 참조로 들어오므로 resolveFillValue
  // 가 DefsMap 에서 LinearGradientFill/RadialGradientFill/PatternFill 객체로 풀어준다.
  const fillRaw = readStyle(el, 'fill', classRules);
  const fill: PartFill = resolveFillValue(fillRaw, defsMap) ?? 'none';
  const stroke = readStyle(el, 'stroke', classRules) ?? 'none';
  const strokeWidth = parseLength(readStyle(el, 'stroke-width', classRules)) ?? 1.5;
  const dasharray = parseDasharray(readStyle(el, 'stroke-dasharray', classRules));
  const linecap = parseEnum(
    readStyle(el, 'stroke-linecap', classRules),
    LINECAPS,
  ) as StrokeLinecap | undefined;
  const linejoin = parseEnum(
    readStyle(el, 'stroke-linejoin', classRules),
    LINEJOINS,
  ) as StrokeLinejoin | undefined;

  const tag = el.nodeName.toLowerCase();
  const partId = `part_${tag}_${index}`;

  // Phase 2: path d 문자열을 anchors+handles로 분해해 편집 가능한 그래프로 보관.
  // svg_paths는 source of truth로 그대로 두고, anchors는 같은 도형의 두 번째 표현.
  // 파서가 빈 결과를 주면 (빈 d, 알 수 없는 명령만 등) 폴백으로 anchors=[].
  const parsed = parsePathD(d, partId);

  // anchors 의 core point 와 handle 까지 포함해 bbox 추출. 정확한 cubic bbox 는 아니지만
  // (handle 이 곡선 밖으로 튀는 케이스 제외) 의류 도식화 수준에선 충분.
  // 핵심 용도 — 그라디언트 편집기에서 단색→선형 변환 시 좌표를 part 영역에 맞춰 잡기.
  const bbox = computeAnchorBbox(parsed.anchors);

  return {
    id: partId,
    category: 'other' as PartCategory,
    svg_paths: [d],
    fill,
    stroke,
    stroke_width: strokeWidth,
    stroke_dasharray: dasharray,
    stroke_linecap: linecap,
    stroke_linejoin: linejoin,
    anchors: parsed.anchors,
    subpath_breaks: parsed.subpath_breaks.length > 0 ? parsed.subpath_breaks : undefined,
    subpath_closed: parsed.subpath_closed.length > 0 ? parsed.subpath_closed : undefined,
    bounding_box: bbox,
    z_index: zIndex,
    editable: true,
    swappable: true,
    transform: { ...DEFAULT_TRANSFORM },
    metadata: { source_tag: tag },
  };
}

// 우선순위: inline style → element class의 CSS rule → element attribute → 부모 chain.
// SVG 스펙 상으론 `style=""`이 CSS rule보다 우선이고, presentation attribute는 그보다 약함.
// Arrow가 내리는 SVG는 거의 class 기반이라 이 단계가 핵심.
function readStyle(el: Element, name: string, classRules: ClassRules): string | null {
  const styleAttr = el.getAttribute('style');
  if (styleAttr) {
    const re = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i');
    const m = re.exec(styleAttr);
    if (m) return m[1].trim();
  }

  const cls = el.getAttribute('class');
  if (cls) {
    const tokens = cls.trim().split(/\s+/);
    // CSS 명시도가 같으면 stylesheet 순서가 결정 — 우리 파서는 뒤에 나온 규칙이 덮어쓰므로
    // element의 class 토큰 순서는 우선순위에 영향 없음. 하지만 token 안에서 첫 번째 매칭만
    // 빠르게 쓰면 충분 (Arrow SVG는 class당 단일 토큰).
    for (const token of tokens) {
      const rule = classRules.get(token);
      if (rule && rule[name] !== undefined) return rule[name];
    }
  }

  const attr = el.getAttribute(name);
  if (attr) return attr.trim();

  const parent = el.parentElement;
  if (parent && parent.nodeName.toLowerCase() !== 'svg') {
    return readStyle(parent, name, classRules);
  }
  return null;
}

// 각 SVG 도형 → path "d" 문자열.
// 핵심은 일관된 Konva.Path 입력 만들기. 정밀한 transform 누적은 Phase 1 범위 밖.
function elementToPathD(el: Element): string | null {
  const tag = el.nodeName.toLowerCase();

  switch (tag) {
    case 'path': {
      const d = el.getAttribute('d');
      return d && d.trim().length > 0 ? d : null;
    }
    case 'line': {
      const x1 = num(el.getAttribute('x1'));
      const y1 = num(el.getAttribute('y1'));
      const x2 = num(el.getAttribute('x2'));
      const y2 = num(el.getAttribute('y2'));
      if ([x1, y1, x2, y2].some((v) => v === null)) return null;
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }
    case 'rect': {
      const x = num(el.getAttribute('x')) ?? 0;
      const y = num(el.getAttribute('y')) ?? 0;
      const w = num(el.getAttribute('width'));
      const h = num(el.getAttribute('height'));
      if (w === null || h === null || w <= 0 || h <= 0) return null;
      return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
    }
    case 'circle': {
      const cx = num(el.getAttribute('cx')) ?? 0;
      const cy = num(el.getAttribute('cy')) ?? 0;
      const r = num(el.getAttribute('r'));
      if (r === null || r <= 0) return null;
      // 원을 두 개의 호로 표현 (Konva.Path 호환).
      return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
    }
    case 'ellipse': {
      const cx = num(el.getAttribute('cx')) ?? 0;
      const cy = num(el.getAttribute('cy')) ?? 0;
      const rx = num(el.getAttribute('rx'));
      const ry = num(el.getAttribute('ry'));
      if (rx === null || ry === null || rx <= 0 || ry <= 0) return null;
      return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
    }
    case 'polygon':
    case 'polyline': {
      const points = el.getAttribute('points');
      if (!points) return null;
      const pairs = points
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n));
      if (pairs.length < 4 || pairs.length % 2 !== 0) return null;
      const cmds: string[] = [`M ${pairs[0]} ${pairs[1]}`];
      for (let i = 2; i < pairs.length; i += 2) {
        cmds.push(`L ${pairs[i]} ${pairs[i + 1]}`);
      }
      if (tag === 'polygon') cmds.push('Z');
      return cmds.join(' ');
    }
    default:
      return null;
  }
}

// 단위(`px`, `pt`, `%`, `em` 등) 떼고 숫자만 추출. `Number()` 직접 호출하면 단위 붙은 값에서
// NaN이 떨어져 stroke-width가 fallback으로 평탄화되는 버그가 있었음.
function parseLength(v: string | null): number | null {
  if (v === null) return null;
  const m = /^[+-]?\d*\.?\d+/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// `stroke-dasharray` → number[]. `none` 또는 빈 값은 undefined로 (점선 아님 = 실선).
function parseDasharray(v: string | null): number[] | undefined {
  if (!v) return undefined;
  const trimmed = v.trim().toLowerCase();
  if (trimmed === 'none' || trimmed.length === 0) return undefined;
  const nums = trimmed
    .split(/[\s,]+/)
    .map((t) => {
      const m = /^[+-]?\d*\.?\d+/.exec(t);
      return m ? Number(m[0]) : NaN;
    })
    .filter((n) => Number.isFinite(n) && n >= 0);
  return nums.length > 0 ? nums : undefined;
}

function parseEnum<T extends string>(
  v: string | null,
  allowed: ReadonlySet<T>,
): T | undefined {
  if (!v) return undefined;
  const t = v.trim().toLowerCase() as T;
  return allowed.has(t) ? t : undefined;
}

function num(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// anchors → axis-aligned bbox. core point 와 cubic handle 좌표 모두 포함.
// 정확한 cubic 곡선 bbox 는 아니지만(드물게 핸들이 곡선 밖으로 더 튀어나가는 경우 제외),
// 그라디언트 좌표를 part 영역에 맞춰 잡는 용도엔 충분히 정확.
function computeAnchorBbox(anchors: Anchor[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (anchors.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const consume = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const a of anchors) {
    consume(a.x, a.y);
    if (a.handle_in) consume(a.handle_in.x, a.handle_in.y);
    if (a.handle_out) consume(a.handle_out.x, a.handle_out.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ────────────────────────────────────────────────────────────
// defs (그라디언트/패턴) 파싱 + fill="url(#id)" 해석
// ────────────────────────────────────────────────────────────

// <defs> 안의 <linearGradient>, <radialGradient>, <pattern> 을 PartFill 객체로 환원해
// id 로 인덱싱한 맵을 만든다. ai-pdf-to-svg 가 만든 SVG 는 gradientUnits="userSpaceOnUse"
// + 절대 좌표라 추가 변환 없이 그대로 캔버스에 매핑 가능. xlink:href 체인은 v1 미지원.
function parseDefs(root: Element): DefsMap {
  const map: DefsMap = new Map();
  const defsEls = root.getElementsByTagName('defs');

  for (let i = 0; i < defsEls.length; i++) {
    const defs = defsEls[i];

    // linearGradient
    const linears = defs.getElementsByTagName('linearGradient');
    for (let j = 0; j < linears.length; j++) {
      const g = linears[j];
      const id = g.getAttribute('id');
      if (!id) continue;
      const x1 = num(g.getAttribute('x1'));
      const y1 = num(g.getAttribute('y1'));
      const x2 = num(g.getAttribute('x2'));
      const y2 = num(g.getAttribute('y2'));
      if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
      const stops = parseStops(g);
      if (stops.length < 2) continue;
      map.set(id, { kind: 'linear', stops, x1, y1, x2, y2 });
    }

    // radialGradient — SVG 의 fx/fy/cx/cy/r 그리고 fr(시작 원 반경).
    // fr 미지정이면 0(점). fx/fy 미지정이면 cx/cy 와 동일(중심 발광).
    const radials = defs.getElementsByTagName('radialGradient');
    for (let j = 0; j < radials.length; j++) {
      const g = radials[j];
      const id = g.getAttribute('id');
      if (!id) continue;
      const cx = num(g.getAttribute('cx'));
      const cy = num(g.getAttribute('cy'));
      const r1 = num(g.getAttribute('r'));
      if (cx === null || cy === null || r1 === null) continue;
      const fx = num(g.getAttribute('fx')) ?? cx;
      const fy = num(g.getAttribute('fy')) ?? cy;
      const r0 = num(g.getAttribute('fr')) ?? 0;
      const stops = parseStops(g);
      if (stops.length < 2) continue;
      map.set(id, {
        kind: 'radial',
        stops,
        fx,
        fy,
        r0,
        cx,
        cy,
        r1,
      });
    }

    // pattern — tileWidth/Height 은 width/height, viewBox 좌표는 svg 내부 그대로,
    // patternTransform 의 matrix(...) 를 transform 객체로 변환.
    const patterns = defs.getElementsByTagName('pattern');
    for (let j = 0; j < patterns.length; j++) {
      const p = patterns[j];
      const id = p.getAttribute('id');
      if (!id) continue;
      const w = num(p.getAttribute('width'));
      const h = num(p.getAttribute('height'));
      if (w === null || h === null || w <= 0 || h <= 0) continue;
      const viewBox = p.getAttribute('viewBox') ?? `0 0 ${w} ${h}`;
      const transform = parseMatrixTransform(p.getAttribute('patternTransform'));
      // pattern 내부를 단일 SVG 문자열로 직렬화 (Konva fillPatternImage 의 src 가 됨).
      const innerXml = serializeChildren(p);
      const svgStr =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}">` +
        innerXml +
        `</svg>`;
      const pat: PatternFill = {
        kind: 'pattern',
        svg: svgStr,
        tileWidth: w,
        tileHeight: h,
      };
      if (transform) pat.transform = transform;
      map.set(id, pat);
    }
  }

  return map;
}

function parseStops(grad: Element): Array<{ offset: number; color: string }> {
  const stops: Array<{ offset: number; color: string }> = [];
  const els = grad.getElementsByTagName('stop');
  for (let i = 0; i < els.length; i++) {
    const s = els[i];
    const offRaw = s.getAttribute('offset');
    let offset = 0;
    if (offRaw) {
      const m = /^([+-]?\d*\.?\d+)(%)?$/.exec(offRaw.trim());
      if (m) {
        const v = Number(m[1]);
        offset = m[2] === '%' ? v / 100 : v;
      }
    }
    if (!Number.isFinite(offset)) offset = 0;
    offset = Math.max(0, Math.min(1, offset));

    // stop-color 는 attribute / inline style 둘 다 허용.
    const color =
      s.getAttribute('stop-color') ??
      pickInlineStyle(s.getAttribute('style'), 'stop-color') ??
      '#000000';

    stops.push({ offset, color: color.trim() });
  }
  return stops;
}

function pickInlineStyle(style: string | null, name: string): string | null {
  if (!style) return null;
  const re = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i');
  const m = re.exec(style);
  return m ? m[1].trim() : null;
}

// "matrix(a b c d e f)" → {a,b,c,d,e,f}. 다른 transform 함수(translate/rotate/scale)는 v1 미지원.
function parseMatrixTransform(
  v: string | null,
): { a: number; b: number; c: number; d: number; e: number; f: number } | undefined {
  if (!v) return undefined;
  const m = /matrix\s*\(([^)]+)\)/i.exec(v);
  if (!m) return undefined;
  const nums = m[1]
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (nums.length !== 6) return undefined;
  return { a: nums[0], b: nums[1], c: nums[2], d: nums[3], e: nums[4], f: nums[5] };
}

function serializeChildren(el: Element): string {
  let out = '';
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c instanceof Element) {
      out += new XMLSerializer().serializeToString(c);
    }
  }
  return out;
}

// fill 원시값을 PartFill 로 환원. "url(#id)" → defsMap 조회, 단색은 그대로 string.
// 매핑 실패(미정의 id, defs 없는 SVG)는 'none' 으로 폴백해 캔버스가 검정으로 채우지 않게.
function resolveFillValue(raw: string | null, defsMap: DefsMap): PartFill | null {
  if (raw === null) return null;
  const v = raw.trim();
  if (v.length === 0) return null;
  const m = /^url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)$/.exec(v);
  if (m) {
    const id = m[1];
    const def = defsMap.get(id);
    if (def) return def;
    // 참조는 했지만 해석 실패 — 검정 채움 방지.
    return 'none';
  }
  return v;
}
