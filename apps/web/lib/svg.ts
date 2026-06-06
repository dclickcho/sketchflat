// Arrow가 내려준 SVG를 inline DOM으로 박기 전에 가벼운 sanitize.
// 화이트리스트가 아닌 블랙리스트 — Arrow 출력은 self-contained라 위험 표면이 좁다.
// 강화가 필요해지면 DOMPurify 의존성을 추가해 교체.
//
// 제거 대상:
//   - <script>: SVG 안에서도 실행될 수 있다.
//   - <foreignObject>: 안에 임의 HTML이 들어갈 수 있어 XSS 표면이 된다.
//   - on* 이벤트 핸들러 (onclick, onload, onerror, ...).
//   - href/xlink:href 속성 중 javascript: 스킴.
//   - <image> 외부 http(s) 참조 — sketches가 self-contained라는 가정에서 벗어남.
//
// 입력은 텍스트 SVG 한 덩이. 출력은 sanitize된 텍스트 + 파싱 실패 여부.

export type SanitizeResult =
  | { ok: true; svg: string }
  | { ok: false; reason: string };

const EVENT_HANDLER_RE = /^on/i;

export function sanitizeSvg(input: string): SanitizeResult {
  // DOMParser는 브라우저 전용. 호출처(클라이언트 컴포넌트)에서만 호출됨을 가정.
  if (typeof DOMParser === 'undefined') {
    return { ok: false, reason: 'DOMParser unavailable (server context?)' };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(input, 'image/svg+xml');

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    return { ok: false, reason: 'SVG 파싱 실패' };
  }

  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') {
    return { ok: false, reason: 'root가 <svg>가 아님' };
  }

  // 위험 요소 제거.
  const removeSelectors = ['script', 'foreignObject'];
  for (const sel of removeSelectors) {
    doc.querySelectorAll(sel).forEach((el) => el.remove());
  }

  // 외부 <image> 참조 제거. data: URL은 허용.
  doc.querySelectorAll('image').forEach((el) => {
    const href =
      el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
    if (/^https?:/i.test(href)) {
      el.remove();
    }
  });

  // on* 이벤트 핸들러 + javascript: 스킴 href 제거.
  const walker = doc.createTreeWalker(root, /* SHOW_ELEMENT */ 1);
  const nodesToScan: Element[] = [root];
  let cur = walker.nextNode();
  while (cur) {
    nodesToScan.push(cur as Element);
    cur = walker.nextNode();
  }
  for (const el of nodesToScan) {
    for (const attr of Array.from(el.attributes)) {
      if (EVENT_HANDLER_RE.test(attr.name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (attr.name === 'href' || attr.name === 'xlink:href') {
        if (/^\s*javascript:/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
    }
  }

  return { ok: true, svg: new XMLSerializer().serializeToString(root) };
}

// SVG 안에서 hit-test 단위를 찾는다.
// 1순위: [data-part-id] (svg-schema의 Part가 주입한 그룹 — 미래 대비)
// 2순위: 그려진 도형 자체 (path/polygon/polyline/rect/circle/ellipse/line)
// 그 외 (svg, g 빈 그룹, defs 등)는 null.
const HIT_TARGET_TAGS = new Set([
  'path',
  'polygon',
  'polyline',
  'rect',
  'circle',
  'ellipse',
  'line',
]);

export type HitResult = {
  // [data-part-id]가 있으면 그 값, 없으면 stroked element의 임시 식별자
  // (DOM 내 인덱스 기반 — 같은 SVG 안에서 안정적이지만 재로드 시에는 달라짐).
  partId: string;
  element: Element;
  // partId 출처. 'data-attr' = data-part-id, 'synthetic' = 인덱스 기반 임시.
  source: 'data-attr' | 'synthetic';
};

export function findHitTarget(target: EventTarget | null): HitResult | null {
  if (!(target instanceof Element)) return null;

  const dataPart = target.closest('[data-part-id]');
  if (dataPart) {
    const id = dataPart.getAttribute('data-part-id');
    if (id) return { partId: id, element: dataPart, source: 'data-attr' };
  }

  // svg-schema Part 메타데이터가 아직 없는 단계 — 그려진 element 자체를 단위로.
  let cur: Element | null = target;
  while (cur && cur.nodeName.toLowerCase() !== 'svg') {
    if (HIT_TARGET_TAGS.has(cur.nodeName.toLowerCase())) {
      const synthetic = ensureSyntheticId(cur);
      return { partId: synthetic, element: cur, source: 'synthetic' };
    }
    cur = cur.parentElement;
  }
  return null;
}

// synthetic id를 element에 부착해서 같은 element가 다시 클릭됐을 때 동일 id로 매핑되게 한다.
let syntheticCounter = 0;
function ensureSyntheticId(el: Element): string {
  const existing = el.getAttribute('data-synthetic-part-id');
  if (existing) return existing;
  const id = `synthetic-${++syntheticCounter}`;
  el.setAttribute('data-synthetic-part-id', id);
  return id;
}
