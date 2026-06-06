// Phase 3 — rawsvg.txt 회귀 테스트.
//
// 실제 셔츠 1장 (Arrow 출력 SVG) 을 parsePathD 로 파싱한 뒤 refineSketch 에 흘려 보고:
//  - faces 가 1개 이상 추출되는가
//  - structural / decorative 분류가 클래스 분포와 일치하는가
//  - anchor 개수 변동 0 (refineSketch 는 anchor 를 mutate 하지 않음 — 시각 회귀 0)
//  - 단일 실행 wall-clock 측정 (p50/p95 는 N=20 반복으로 추정)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_TRANSFORM, type Anchor, type Part } from '../src/index';
import { parsePathD } from '../src/path-parser';
import { refineSketch } from '../src/refinement';

interface ParsedSvg {
  parts: Part[];
  classCounts: Map<string, number>;
}

// 최소한의 regex 기반 파서. apps/web 의 parseArrowSvgServer 의 회귀 테스트 카피본.
// 이 패키지에 server 파서를 들이지 않기 위해 테스트 안에서만 인라인.
function parseArrowSvg(rawSvg: string): ParsedSvg {
  // class → { stroke_width, dasharray }
  const styleMatch = rawSvg.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  const styleSheet = new Map<string, { strokeWidth: number; dasharray: number[] | undefined }>();
  if (styleMatch) {
    const text = styleMatch[1]!;
    const ruleRe = /\.(cls-\d+)\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(text)) !== null) {
      const cls = m[1]!;
      const body = m[2]!;
      const swMatch = body.match(/stroke-width\s*:\s*([\d.]+)/);
      const daMatch = body.match(/stroke-dasharray\s*:\s*([^;]+)/);
      styleSheet.set(cls, {
        strokeWidth: swMatch ? parseFloat(swMatch[1]!) : 1,
        dasharray: daMatch
          ? daMatch[1]!.trim().split(/[\s,]+/).map((v) => parseFloat(v)).filter((v) => !isNaN(v))
          : undefined,
      });
    }
  }

  const classCounts = new Map<string, number>();
  const pathRe = /<path\s+([^>]*?)\/?>/g;
  const parts: Part[] = [];
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(rawSvg)) !== null) {
    const attrs = m[1]!;
    const classMatch = attrs.match(/class="([^"]+)"/);
    const dMatch = attrs.match(/d="([^"]+)"/);
    if (!dMatch) continue;
    const cls = classMatch ? classMatch[1]!.trim().split(/\s+/)[0]! : '';
    classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1);
    const sty = cls ? styleSheet.get(cls) : undefined;
    const parsed = parsePathD(dMatch[1]!, `p${idx}`);
    if (parsed.anchors.length === 0) continue;
    const xs = parsed.anchors.map((a) => a.x);
    const ys = parsed.anchors.map((a) => a.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    parts.push({
      id: `p${idx++}`,
      category: 'other',
      svg_paths: [dMatch[1]!],
      fill: 'none',
      stroke: '#000000',
      stroke_width: sty?.strokeWidth ?? 1,
      stroke_dasharray: sty?.dasharray,
      anchors: parsed.anchors,
      subpath_breaks: parsed.subpath_breaks.length > 0 ? parsed.subpath_breaks : undefined,
      subpath_closed: parsed.subpath_closed,
      bounding_box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      z_index: idx,
      editable: true,
      swappable: true,
      transform: DEFAULT_TRANSFORM,
      metadata: cls ? { source_class: cls } : {},
    });
  }
  return { parts, classCounts };
}

describe('rawsvg.txt 회귀 — 셔츠 1장', () => {
  const rawPath = resolve(__dirname, '..', '..', '..', 'rawsvg.txt');
  const rawSvg = readFileSync(rawPath, 'utf-8');
  const { parts, classCounts } = parseArrowSvg(rawSvg);

  it('파싱: 클래스 분포 콘솔 출력 + part 가 추출됨', () => {
    expect(parts.length).toBeGreaterThan(0);
    const dist = [...classCounts.entries()].sort();
    console.log(`[regression] 셔츠 part=${parts.length}, 클래스 분포:`, Object.fromEntries(dist));
  });

  it('refineSketch — face >= 1, anchor 변동 0, structural 비율', () => {
    const inputAnchorTotal = parts.reduce((sum, p) => sum + p.anchors.length, 0);
    const result = refineSketch(parts);
    const outputAnchorTotal = result.parts.reduce((sum, p) => sum + p.anchors.length, 0);

    let structuralCount = 0;
    let decorativeCount = 0;
    for (const role of result.roles.values()) {
      if (role === 'structural') structuralCount += 1;
      else decorativeCount += 1;
    }

    // 클래스별 orphan 분포.
    const perClass = new Map<string, { total: number; orphans: number; structural: number }>();
    const partById = new Map(parts.map((p) => [p.id, p]));
    for (const out of result.parts) {
      const cls = (partById.get(out.id)?.metadata?.['source_class'] ?? 'none');
      let entry = perClass.get(cls);
      if (!entry) {
        entry = { total: 0, orphans: 0, structural: 0 };
        perClass.set(cls, entry);
      }
      entry.total += 1;
      if (result.roles.get(out.id) === 'structural') entry.structural += 1;
      else if (out.parent_face_id === undefined) entry.orphans += 1;
    }
    const breakdown = [...perClass.entries()]
      .sort()
      .map(
        ([cls, v]) =>
          `${cls}:${v.total}(struct=${v.structural} orphan=${v.orphans})`,
      )
      .join(' ');

    console.log(
      `[regression] refine: parts=${parts.length} ` +
        `(structural=${structuralCount}, decorative=${decorativeCount}) ` +
        `→ faces=${result.faces.length}, orphans=${result.orphanCount}, ` +
        `anchor_in=${inputAnchorTotal}, anchor_out=${outputAnchorTotal}`,
    );
    console.log(`[regression] cls breakdown: ${breakdown}`);

    // face 폴리곤 진단 — id, bbox, 폴리곤 점 수, signed_area.
    const faceDiag = result.faces
      .map(
        (f) =>
          `${f.id}: bbox=(${f.bounding_box.x.toFixed(0)},${f.bounding_box.y.toFixed(0)},` +
          `${f.bounding_box.width.toFixed(0)}x${f.bounding_box.height.toFixed(0)}) ` +
          `npts=${f.flat_polygon.length} area=${f.signed_area.toFixed(0)}`,
      )
      .join('\n  ');
    console.log(`[regression] faces:\n  ${faceDiag}`);

    // orphan 분포 — 위치 (bbox 중심) 가 어디 모여 있는지.
    const orphanCenters: Array<[number, number]> = [];
    for (const out of result.parts) {
      if (result.roles.get(out.id) !== 'decorative') continue;
      if (out.parent_face_id !== undefined) continue;
      const cx = out.bounding_box.x + out.bounding_box.width / 2;
      const cy = out.bounding_box.y + out.bounding_box.height / 2;
      orphanCenters.push([cx, cy]);
    }
    if (orphanCenters.length > 0) {
      const minX = Math.min(...orphanCenters.map((c) => c[0]));
      const maxX = Math.max(...orphanCenters.map((c) => c[0]));
      const minY = Math.min(...orphanCenters.map((c) => c[1]));
      const maxY = Math.max(...orphanCenters.map((c) => c[1]));
      console.log(
        `[regression] orphan 분포: n=${orphanCenters.length} ` +
          `x=${minX.toFixed(0)}..${maxX.toFixed(0)} y=${minY.toFixed(0)}..${maxY.toFixed(0)}`,
      );
    }

    // anchor 변동은 0 — refineSketch 는 anchor 를 추가/삭제하지 않는다.
    expect(outputAnchorTotal).toBe(inputAnchorTotal);
    // face 가 최소 1개 추출돼야 한다 (구조선 cls-1 이 5개 이상 있으므로).
    expect(result.faces.length).toBeGreaterThanOrEqual(1);
    // structural 분류가 1개 이상 있어야 한다.
    expect(structuralCount).toBeGreaterThanOrEqual(1);
    // orphan 비율 < 90% — 전부가 root 자식이면 hierarchy 가 사실상 동작하지 않는 것.
    if (decorativeCount > 0) {
      const orphanRatio = result.orphanCount / decorativeCount;
      expect(orphanRatio).toBeLessThan(0.9);
    }
  });

  it('타이밍: 20회 반복으로 p50/p95 추정', () => {
    const N = 20;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) {
      const t = performance.now();
      refineSketch(parts);
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(N * 0.5)]!;
    const p95 = samples[Math.floor(N * 0.95)]!;
    const min = samples[0]!;
    const max = samples[N - 1]!;
    console.log(
      `[regression] timing N=${N}: ` +
        `min=${min.toFixed(1)}ms p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`,
    );
    // DoD: p95 ≤ 200ms.
    expect(p95).toBeLessThanOrEqual(200);
  });
});
