import type { PartCategory } from './parts';

// 부위 카테고리별 z-index base. 100 단위 padding 으로 같은 카테고리 안에서도
// 슬롯/사이드를 더해 충돌 없이 z-order 를 채울 수 있다.
//
// 의도된 스택 (낮음 → 높음, 뒤 → 앞):
//   소매(왼쪽=0, 오른쪽=100) → 몸판(200) → 넥라인(350) → 플라켓(300) → 카라(400)
//   → 커프(500) → 주머니(600) → 기타(700)
//
// neckline 은 plaket 보다 살짝 낮게 두어 깊이감 표현 (V/round 가 plaket 아래로 가려야 자연).
export const CATEGORY_Z_BASE: Record<PartCategory, number> = {
  sleeve: 0,
  body: 200,
  neckline: 350,
  placket: 300,
  collar: 400,
  cuff: 500,
  pocket: 600,
  // 아래는 현재 부위 분리 파이프라인에서 직접 다루지 않지만 안전한 기본값으로 채워 둠.
  shoulder: 250,
  hem: 220,
  waistband: 230,
  leg: 240,
  pants_pocket: 610,
  button: 800,
  zipper: 810,
  label: 820,
  other: 700,
};

// 좌우 sleeve 가 단일 클래스이므로 추론 후 x-center 로 분기. left=base, right=base+100.
export type Side = 'left' | 'right';

export function assignZIndex(category: PartCategory, side?: Side | null, slot = 0): number {
  const base = CATEGORY_Z_BASE[category] ?? CATEGORY_Z_BASE.other;
  const sideOffset = side === 'right' ? 100 : 0;
  return base + sideOffset + Math.max(0, Math.min(slot, 99));
}

// 그룹 ID 생성 규칙. 같은 카테고리/사이드 내 part 들은 동일 group_id 공유.
export function buildGroupId(category: PartCategory, side?: Side | null): string {
  return side ? `grp_${category}_${side}` : `grp_${category}`;
}

// 사람이 읽는 그룹 라벨. Sketch.group_names 에 등록되어 레이어 패널에 표시된다.
export const GROUP_NAMES_KO: Record<string, string> = {
  grp_sleeve_left: '왼쪽 소매',
  grp_sleeve_right: '오른쪽 소매',
  grp_sleeve: '소매',
  grp_body: '몸판',
  grp_placket: '플라켓',
  grp_collar: '카라',
  grp_neckline: '넥라인',
  grp_cuff: '커프',
  grp_pocket: '주머니',
  grp_other: '기타',
};

export function groupLabel(groupId: string): string {
  return GROUP_NAMES_KO[groupId] ?? groupId;
}
