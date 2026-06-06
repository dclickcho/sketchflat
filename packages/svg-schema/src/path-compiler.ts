// anchors + sub-path 메타데이터 → SVG path `d` 문자열.
// 절대 명령(M/L/C/Z)만 사용 — 단순하고 라운드트립이 결정적이라 디버깅 용이.
//
// 컴파일 규칙:
//  - 각 sub-path는 첫 anchor에서 `M x y`로 시작.
//  - 두 인접 anchor 사이에 핸들이 하나라도 있으면 cubic `C h1 h2 end`. 없으면 `L end`.
//    핸들이 한쪽만 있는 경우 비어있는 쪽은 그쪽 anchor 위치 자체로 폴백 (직선과 닮은 cubic).
//  - subpath_closed[i] === true면 `Z`로 끝.
//  - 좌표는 toFixed(3) 후 Number로 wrap → trailing zero 자동 제거.

import type { Anchor } from './anchors';

export function compileAnchorsToD(
  anchors: Anchor[],
  subpath_breaks?: number[],
  subpath_closed?: boolean[],
): string {
  if (anchors.length === 0) return '';

  const breaks = subpath_breaks ?? [];
  const closed = subpath_closed ?? [];

  // 각 sub-path의 시작 인덱스 + 끝 인덱스(exclusive)를 미리 계산.
  // 예: anchors.length=5, breaks=[2] → [[0,2),[2,5)].
  const starts = [0, ...breaks];
  const ranges: Array<[number, number]> = starts.map((s, i) => {
    const next = starts[i + 1];
    const e = next !== undefined ? next : anchors.length;
    return [s, e];
  });

  const out: string[] = [];
  ranges.forEach(([s, e], subpathIdx) => {
    if (s >= e) return;
    const first = anchors[s];
    if (!first) return;
    out.push(`M ${fmt(first.x)} ${fmt(first.y)}`);
    for (let i = s + 1; i < e; i++) {
      const prev = anchors[i - 1];
      const cur = anchors[i];
      if (!prev || !cur) continue;
      if (prev.handle_out || cur.handle_in) {
        // 한쪽만 있을 때 폴백: 그쪽 anchor 좌표 자체. 결과적으로 cubic이 직선에 거의 근사.
        const h1 = prev.handle_out ?? { x: prev.x, y: prev.y };
        const h2 = cur.handle_in ?? { x: cur.x, y: cur.y };
        out.push(`C ${fmt(h1.x)} ${fmt(h1.y)} ${fmt(h2.x)} ${fmt(h2.y)} ${fmt(cur.x)} ${fmt(cur.y)}`);
      } else {
        out.push(`L ${fmt(cur.x)} ${fmt(cur.y)}`);
      }
    }
    if (closed[subpathIdx]) out.push('Z');
  });

  return out.join(' ');
}

// 소수점 3자리 + 불필요한 trailing zero 제거. Number(n.toFixed(3))은 1.500 → 1.5.
function fmt(n: number): string {
  return String(Number(n.toFixed(3)));
}
