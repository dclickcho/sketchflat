// 의류 도식화용 기본 패턴 브러쉬 프리셋 모음.
//
// 좌표 규약 (svg-schema/brushes.ts 참고):
//  - 타일 아트는 "수평"으로 author. 패스 진행 방향 = +x, 법선 = +y.
//  - 패스는 타일의 y=0 (baseline) 을 따라간다 → 모든 path 데이터는 y=0 을
//    가로지르도록(위아래로 분포) 작성. width 만큼 +x 로 진행하면 다음 타일이
//    끊김없이 이어져야 한다 (시작 x=0, 끝 x=width 에서 연속).
//
// 각 타일은 단색 라인아트(stroke 위주, fill 'none')이며, BrushDefinitionSchema.parse
// 로 런타임 검증을 통과시켜 내보낸다.

import {
  BrushDefinitionSchema,
  type BrushDefinition,
} from '@sketchflat/svg-schema';

// 검증되지 않은 프리셋 원본. 모든 필드를 명시(기본값 의존 금지)한다.
// 배열을 BrushDefinitionSchema 로 parse 해 최종 BRUSH_PRESETS 를 만든다.
const RAW_PRESETS = [
  // ── 지퍼 (zipper) ───────────────────────────────────────────────
  // width 12: 가운데 테이프 라인 2줄(y=-1.5, y=+1.5) + 6 간격으로 양쪽 이빨.
  // baseline(y=0) 은 두 테이프 라인 사이의 중심선. 이빨은 짧은 대각 stroke.
  {
    id: 'preset-zipper',
    name: '지퍼',
    category: 'zipper',
    source: 'preset',
    tiles: {
      side: {
        paths: [
          // 위/아래 테이프 라인 (x 0→12 연속).
          'M0 -1.5 L12 -1.5',
          'M0 1.5 L12 1.5',
          // 윗줄 이빨 2개 (테이프 위쪽 5 위치, baseline 위쪽으로 짧게).
          'M2 -1.5 L2 -4',
          'M8 -1.5 L8 -4',
          // 아랫줄 이빨 2개 (윗줄과 엇갈리게 배치).
          'M5 1.5 L5 4',
          'M11 1.5 L11 4',
        ],
        width: 12,
        height: 8,
      },
    },
    scale: 1,
    spacing: 0,
    flipAlong: false,
    flipAcross: false,
    fit: 'approximate',
    colorization: 'none',
    stroke: '#000000',
    stroke_width: 1,
    fill: 'none',
  },

  // ── 레이스 (lace) ───────────────────────────────────────────────
  // width 16: 아래로 늘어지는 스캘럽(반원) 1개 + 사이에 picot 점 2개.
  // baseline(y=0) 에서 시작해 아래(+y)로 반원이 늘어진다.
  {
    id: 'preset-lace',
    name: '레이스',
    category: 'lace',
    source: 'preset',
    tiles: {
      side: {
        paths: [
          // 윗선(baseline) — 타일이 매달리는 가장자리.
          'M0 0 L16 0',
          // 아래로 늘어지는 반원 스캘럽 (x 0→16, 아래로 6 만큼).
          'M0 0 C2 7, 14 7, 16 0',
          // picot 작은 점(아주 작은 원호) — 스캘럽 양쪽.
          'M3 4.5 a0.6 0.6 0 1 0 0.01 0',
          'M13 4.5 a0.6 0.6 0 1 0 0.01 0',
        ],
        width: 16,
        height: 10,
      },
    },
    scale: 1,
    spacing: 0,
    flipAlong: false,
    flipAcross: false,
    fit: 'approximate',
    colorization: 'none',
    stroke: '#000000',
    stroke_width: 0.8,
    fill: 'none',
  },

  // ── 주름 (pleat) ────────────────────────────────────────────────
  // width 10: 사선 주름 라인 2줄 반복. baseline(y=0) 위아래로 ±5 분포.
  // 사선 끝점이 x=10 에서 다음 타일 시작과 이어지도록 평행.
  {
    id: 'preset-pleat',
    name: '주름',
    category: 'pleat',
    source: 'preset',
    tiles: {
      side: {
        paths: [
          // 사선 주름 1 (아래→위로 기울어진 선).
          'M0 5 L5 -5',
          // 사선 주름 2 (다음 주름, x=10 끝에서 연속).
          'M5 5 L10 -5',
        ],
        width: 10,
        height: 10,
      },
    },
    scale: 1,
    spacing: 0,
    flipAlong: false,
    flipAcross: false,
    fit: 'approximate',
    colorization: 'none',
    stroke: '#000000',
    stroke_width: 1,
    fill: 'none',
  },

  // ── 토프스티치 (topstitch) ──────────────────────────────────────
  // width 6: baseline 위의 짧은 대시 1개 + 간격. 반복 시 일정 간격 점선.
  {
    id: 'preset-topstitch',
    name: '토프스티치',
    category: 'stitch',
    source: 'preset',
    tiles: {
      side: {
        // 대시는 x 1→5 (앞뒤로 1씩 여백) → 반복 간격이 균일.
        paths: ['M1 0 L5 0'],
        width: 6,
        height: 2,
      },
    },
    scale: 1,
    spacing: 0,
    flipAlong: false,
    flipAcross: false,
    fit: 'approximate',
    colorization: 'none',
    stroke: '#000000',
    stroke_width: 1.2,
    fill: 'none',
  },

  // ── 스캘럽 (scallop) ────────────────────────────────────────────
  // width 12: 위로 솟는 반원 호 1개 반복 가장자리. baseline(y=0) 에서
  // 위(-y)로 볼록한 호. x=0, x=12 에서 baseline 에 닿아 연속.
  {
    id: 'preset-scallop',
    name: '스캘럽',
    category: 'trim',
    source: 'preset',
    tiles: {
      side: {
        // 반원 호: (0,0) → (12,0), 위로 볼록(반지름 6).
        paths: ['M0 0 A6 6 0 0 1 12 0'],
        width: 12,
        height: 6,
      },
    },
    scale: 1,
    spacing: 0,
    flipAlong: false,
    flipAcross: false,
    fit: 'approximate',
    colorization: 'none',
    stroke: '#000000',
    stroke_width: 1,
    fill: 'none',
  },

  // ── 러닝 스티치 (running stitch) ────────────────────────────────
  // 토프스티치보다 촘촘한 점선. width 4, 대시 x 0.5→3.
  {
    id: 'preset-running-stitch',
    name: '러닝 스티치',
    category: 'stitch',
    source: 'preset',
    tiles: {
      side: {
        paths: ['M0.5 0 L3 0'],
        width: 4,
        height: 1.5,
      },
    },
    scale: 1,
    spacing: 0,
    flipAlong: false,
    flipAcross: false,
    fit: 'approximate',
    colorization: 'none',
    stroke: '#000000',
    stroke_width: 1,
    fill: 'none',
  },

  // ── 지그재그 (zigzag) ───────────────────────────────────────────
  // 오버록/지그재그 스티치. width 8, baseline 위아래로 ±3 톱니.
  {
    id: 'preset-zigzag',
    name: '지그재그',
    category: 'stitch',
    source: 'preset',
    tiles: {
      side: {
        // (0,0)→(2,-3)→(4,0)→(6,3)→(8,0): 한 주기, x=8 에서 baseline 복귀.
        paths: ['M0 0 L2 -3 L4 0 L6 3 L8 0'],
        width: 8,
        height: 6,
      },
    },
    scale: 1,
    spacing: 0,
    flipAlong: false,
    flipAcross: false,
    fit: 'approximate',
    colorization: 'none',
    stroke: '#000000',
    stroke_width: 1,
    fill: 'none',
  },
] as const;

// 런타임 검증 — 좌표/필드가 스키마를 만족하지 않으면 모듈 로드 시 throw.
export const BRUSH_PRESETS: BrushDefinition[] = RAW_PRESETS.map((p) =>
  BrushDefinitionSchema.parse(p),
);

// id 로 프리셋 브러쉬를 찾는다. 없으면 undefined.
export function getPresetBrush(id: string): BrushDefinition | undefined {
  return BRUSH_PRESETS.find((b) => b.id === id);
}
