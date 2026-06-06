// 서버 (Node.js) 측 SVG → Part[] 파서. DOMParser 가 없는 환경에서 동작해야 한다.
//
// Arrow(QuiverAI) 1.1 의 출력 SVG 는 트리가 매우 단순 — `<svg>` 한 단계에 `<style>` +
// flat 한 `<path>/<rect>/<line>/...` 만 들어 있다. 따라서 정규식 기반 추출로 충분.
//
// 정제 파이프라인 진입점: route 가 raw SVG 문자열을 받아 이 함수로 Part[] 를 만들고
// `refineSketch()` 에 넣은 뒤 `parts-to-svg.serializePartsToSvg()` 로 다시 직렬화한다.
//
// 클라이언트 측 svg-to-parts.ts 의 정책 (style/class/attribute fallback chain, dasharray
// parser 등) 을 서버에서도 동일하게 재현한다 — 두 파서가 같은 입력에 대해 동일한 Part 를
// 내야 회귀비교가 의미가 있다.

import type {
  Part,
  PartCategory,
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
type AttrMap = Map<string, string>;

export interface ParsedSvgServerResult {
  parts: Part[];
  canvas: { width: number; height: number };
  /** 원본 viewBox 문자열 (직렬화 시 그대로 재출력). */
  viewBox: string | null;
  /** `<style>` 태그 내부 텍스트들의 결합 — 직렬화 시 그대로 재삽입. */
  styleBlock: string;
}

export function parseArrowSvgServer(rawSvg: string): ParsedSvgServerResult | null {
  // SVG 루트 태그 추출.
  const svgOpen = /<svg\b([^>]*)>/i.exec(rawSvg);
  if (!svgOpen) return null;
  const rootAttrs = parseAttrs(svgOpen[1] ?? '');

  const widthAttr = rootAttrs.get('width') ?? null;
  const heightAttr = rootAttrs.get('height') ?? null;
  const viewBox = rootAttrs.get('viewbox') ?? rootAttrs.get('viewBox') ?? null;
  const canvas = inferCanvasSize(widthAttr, heightAttr, viewBox);

  // <style> 태그들의 텍스트 결합 → 동일한 클래스 룰 파서 적용.
  const styleBlocks: string[] = [];
  const STYLE_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = STYLE_RE.exec(rawSvg)) !== null) {
    styleBlocks.push(sm[1] ?? '');
  }
  const styleBlock = styleBlocks.join('\n');
  const classRules = parseStyleSheet(styleBlock);

  // 도형 원소 추출 — self-closing 또는 일반 close 둘 다 매칭.
  // 주의: Arrow SVG 는 도형이 모두 self-closing 이지만 안전하게 둘 다 커버.
  const SHAPE_RE = /<(path|line|rect|circle|ellipse|polygon|polyline)\b([^>]*?)\/>|<(path|line|rect|circle|ellipse|polygon|polyline)\b([^>]*?)>([\s\S]*?)<\/\3>/gi;
  const parts: Part[] = [];
  let zIndex = 0;
  let idCounter = 0;
  let m: RegExpExecArray | null;
  while ((m = SHAPE_RE.exec(rawSvg)) !== null) {
    const tag = (m[1] ?? m[3] ?? '').toLowerCase();
    if (!SHAPE_TAGS.has(tag)) continue;
    const attrText = m[2] ?? m[4] ?? '';
    const attrs = parseAttrs(attrText);
    const part = elementToPart(tag, attrs, idCounter, zIndex, classRules);
    if (part) {
      parts.push(part);
      idCounter += 1;
      zIndex += 1;
    }
  }

  return { parts, canvas, viewBox, styleBlock };
}

function parseStyleSheet(text: string): ClassRules {
  const rules: ClassRules = new Map();
  const RULE_RE = /\.([a-zA-Z_][\w-]*)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = RULE_RE.exec(text)) !== null) {
    const cls = m[1] ?? '';
    const body = m[2] ?? '';
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
  return rules;
}

function parseAttrs(text: string): AttrMap {
  const out: AttrMap = new Map();
  // name="value" | name='value' | name=value (unquoted, drops at whitespace)
  const RE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    const name = m[1]!.toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    out.set(name, value);
  }
  return out;
}

function inferCanvasSize(
  widthAttr: string | null,
  heightAttr: string | null,
  viewBox: string | null,
): { width: number; height: number } {
  const w = parseLength(widthAttr);
  const h = parseLength(heightAttr);
  if (w !== null && h !== null && w > 0 && h > 0) return { width: w, height: h };

  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const vbW = parts[2]!;
      const vbH = parts[3]!;
      if (vbW > 0 && vbH > 0) return { width: vbW, height: vbH };
    }
  }
  return { width: 800, height: 1000 };
}

function elementToPart(
  tag: string,
  attrs: AttrMap,
  index: number,
  zIndex: number,
  classRules: ClassRules,
): Part | null {
  const d = elementToPathD(tag, attrs);
  if (!d) return null;

  const fill = readStyle(attrs, 'fill', classRules) ?? 'none';
  const stroke = readStyle(attrs, 'stroke', classRules) ?? 'none';
  const strokeWidth = parseLength(readStyle(attrs, 'stroke-width', classRules)) ?? 1.5;
  const dasharray = parseDasharray(readStyle(attrs, 'stroke-dasharray', classRules));
  const linecap = parseEnum(readStyle(attrs, 'stroke-linecap', classRules), LINECAPS) as
    | StrokeLinecap
    | undefined;
  const linejoin = parseEnum(readStyle(attrs, 'stroke-linejoin', classRules), LINEJOINS) as
    | StrokeLinejoin
    | undefined;

  const partId = `part_${tag}_${index}`;
  const parsed = parsePathD(d, partId);

  // 원본 class 토큰 (직렬화 시 재사용). 다중 토큰이면 첫 번째만 보존 — Arrow 는 단일 토큰.
  const cls = (attrs.get('class') ?? '').trim().split(/\s+/).filter(Boolean)[0] ?? '';
  const metadata: Record<string, string> = { source_tag: tag };
  if (cls) metadata.source_class = cls;

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
    bounding_box: { x: 0, y: 0, width: 0, height: 0 },
    z_index: zIndex,
    editable: true,
    swappable: true,
    transform: { ...DEFAULT_TRANSFORM },
    metadata,
  };
}

function readStyle(attrs: AttrMap, name: string, classRules: ClassRules): string | null {
  // 1) inline style="..." 우선.
  const styleAttr = attrs.get('style');
  if (styleAttr) {
    const re = new RegExp(`(?:^|;)\\s*${escapeForRegex(name)}\\s*:\\s*([^;]+)`, 'i');
    const m = re.exec(styleAttr);
    if (m) return (m[1] ?? '').trim();
  }
  // 2) class 룰.
  const cls = attrs.get('class');
  if (cls) {
    const tokens = cls.trim().split(/\s+/);
    for (const token of tokens) {
      const rule = classRules.get(token);
      if (rule && rule[name] !== undefined) return rule[name];
    }
  }
  // 3) presentation attribute.
  const attr = attrs.get(name);
  if (attr) return attr.trim();
  return null;
}

function elementToPathD(tag: string, attrs: AttrMap): string | null {
  switch (tag) {
    case 'path': {
      const d = attrs.get('d');
      return d && d.trim().length > 0 ? d : null;
    }
    case 'line': {
      const x1 = num(attrs.get('x1'));
      const y1 = num(attrs.get('y1'));
      const x2 = num(attrs.get('x2'));
      const y2 = num(attrs.get('y2'));
      if ([x1, y1, x2, y2].some((v) => v === null)) return null;
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }
    case 'rect': {
      const x = num(attrs.get('x')) ?? 0;
      const y = num(attrs.get('y')) ?? 0;
      const w = num(attrs.get('width'));
      const h = num(attrs.get('height'));
      if (w === null || h === null || w <= 0 || h <= 0) return null;
      return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
    }
    case 'circle': {
      const cx = num(attrs.get('cx')) ?? 0;
      const cy = num(attrs.get('cy')) ?? 0;
      const r = num(attrs.get('r'));
      if (r === null || r <= 0) return null;
      return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
    }
    case 'ellipse': {
      const cx = num(attrs.get('cx')) ?? 0;
      const cy = num(attrs.get('cy')) ?? 0;
      const rx = num(attrs.get('rx'));
      const ry = num(attrs.get('ry'));
      if (rx === null || ry === null || rx <= 0 || ry <= 0) return null;
      return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
    }
    case 'polygon':
    case 'polyline': {
      const points = attrs.get('points');
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

function parseLength(v: string | null): number | null {
  if (v === null) return null;
  const m = /^[+-]?\d*\.?\d+/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

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

function parseEnum<T extends string>(v: string | null, allowed: ReadonlySet<T>): T | undefined {
  if (!v) return undefined;
  const t = v.trim().toLowerCase() as T;
  return allowed.has(t) ? t : undefined;
}

function num(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
