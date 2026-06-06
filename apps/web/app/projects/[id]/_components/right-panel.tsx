'use client';
// useEditorStore(selectedPartIds, sketch.parts, activeTool, selectedArtboardId)를 구독하므로 Client Component.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  Plus,
  Minus,
  Eye,
  EyeOff,
  Droplet,
  ChevronDown,
  ChevronRight,
  Component,
  MoreHorizontal,
  Check,
  FlipHorizontal,
  FlipVertical,
  X,
  ArrowLeftRight,
  RotateCw,
} from 'lucide-react';
import { useEditorStore, useTemporalStore } from '@/lib/editor-store';
import type { ArtboardPatch, AlignAction } from '@/lib/editor-store';
import type {
  Part,
  PartFill,
  LinearGradientFill,
  RadialGradientFill,
  Transform,
  BrushApplication,
  BrushDefinition,
  StrokeLinecap,
} from '@sketchflat/svg-schema';
import { DEFAULT_TRANSFORM, fillToCssColor } from '@sketchflat/svg-schema';
import { findBrushDefinition, allBrushes } from '@/lib/brush-lookup';
import {
  exportPartsAs,
  type ExportFormat,
  type ExportRow,
} from '@/lib/export-parts';

interface RightPanelProps {
  userInitial: string;
}

export function RightPanel({ userInitial }: RightPanelProps) {
  // 대지 도구에서는 속성 콘텐츠가 대지 사이즈로 바뀐다.
  const activeTool = useEditorStore((s) => s.activeTool);
  const isArtboardMode = activeTool === 'artboard';
  return (
    <aside
      className="w-60 flex flex-col shrink-0 border-l"
      style={{
        backgroundColor: 'hsl(var(--editor-panel))',
        borderColor: 'hsl(var(--editor-border))',
      }}
    >
      <ProfileShareRow userInitial={userInitial} />

      <div className="flex-1 overflow-y-auto">
        {isArtboardMode ? <ArtboardPropertiesContent /> : <VectorPropertiesContent />}
      </div>
    </aside>
  );
}

function ProfileShareRow({ userInitial }: { userInitial: string }) {
  function handleShare() {
    // TODO: Konva Stage.toDataURL()로 PNG 내보내기 + 공유 링크 (Week 2).
    console.log('공유하기 — 추후 구현');
  }

  return (
    <div
      className="h-11 px-3 flex items-center justify-between gap-2 border-b shrink-0 bg-white"
      style={{ borderColor: 'hsl(var(--editor-border))' }}
    >
      <button
        type="button"
        aria-label="프로필"
        className="w-7 h-7 rounded-full bg-emerald-500 text-white text-[12px] font-semibold flex items-center justify-center hover:opacity-90 transition-opacity shrink-0"
      >
        {userInitial}
      </button>
      <button
        onClick={handleShare}
        className="rounded-md bg-black px-3 h-7 text-[12px] text-white hover:bg-black/85 transition-colors"
        style={{ fontWeight: 500, letterSpacing: '-0.14px' }}
      >
        공유하기
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 대지 모드 — 사이즈 편집 패널
// ─────────────────────────────────────────────────────────────────────────
function ArtboardPropertiesContent() {
  const artboards = useEditorStore((s) => s.sketch?.artboards);
  const selectedArtboardId = useEditorStore((s) => s.selectedArtboardId);
  const updateArtboard = useEditorStore((s) => s.updateArtboard);

  const selectedArtboard = selectedArtboardId
    ? (artboards ?? []).find((a) => a.id === selectedArtboardId) ?? null
    : null;

  if (!selectedArtboard) {
    return (
      <div className="px-3 py-3">
        <p
          className="text-[11px] text-[hsl(var(--editor-mute))]"
          style={{ letterSpacing: '-0.14px' }}
        >
          대지를 선택하거나 드래그로 새 대지를 만드세요.
        </p>
      </div>
    );
  }

  function patch(p: ArtboardPatch) {
    updateArtboard(selectedArtboard!.id, p);
  }

  return (
    <div>
      {/* 제목줄 — 벡터 파트(사각형/타원/패스)와 동일 스타일로 "대지" 라벨 표시. */}
      <div
        className="px-3 h-9 flex items-center justify-between border-b"
        style={{ borderColor: 'hsl(var(--editor-border))' }}
      >
        <span
          className="text-[12px] font-semibold text-foreground"
          style={{ letterSpacing: '-0.14px' }}
        >
          대지
        </span>
      </div>

      {/* 이름·사이즈는 그 아래에 별도 섹션으로. */}
      <SectionHeader title="대지" />
      <div className="px-3 pt-2 pb-3 space-y-2">
        <LabeledInput
          label="이름"
          value={selectedArtboard.name}
          onChange={(v) => patch({ name: v })}
        />
        <div className="grid grid-cols-2 gap-1.5">
          <NumInput
            label="W"
            value={Math.round(selectedArtboard.width)}
            onChange={(v) => patch({ width: v })}
          />
          <NumInput
            label="H"
            value={Math.round(selectedArtboard.height)}
            onChange={(v) => patch({ height: v })}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 벡터 경로 (파트) 속성 — figma 패널 레퍼런스 구조
// 위치(정렬·X/Y·회전) → 레이아웃(W/H) → 외형(불투명도) → 채우기 → 외곽선
// ─────────────────────────────────────────────────────────────────────────

// 파트 ID prefix 로 도형 종류를 식별 — createRectPart / createEllipsePart / createPenPart 가
// 각각 `part_rect_` / `part_ellipse_` / `part_pen_` prefix 를 부여하므로 id 만으로 충분.
// 그 외(임포트된 SVG, Pathfinder 결과 등)는 모두 일반 패스로 취급.
function getPartTypeLabel(part: Part): string {
  const id = part.id;
  if (id.startsWith('part_rect_')) return '사각형';
  if (id.startsWith('part_ellipse_')) return '타원';
  if (id.startsWith('part_text_')) return '텍스트';
  return '패스';
}

function VectorPropertiesContent() {
  const selectedPartIds = useEditorStore((s) => s.selectedPartIds);
  const parts = useEditorStore((s) => s.sketch?.parts);
  const updatePartStyle = useEditorStore((s) => s.updatePartStyle);
  const updatePartTransform = useEditorStore((s) => s.updatePartTransform);
  const toggleVisibility = useEditorStore((s) => s.toggleVisibility);

  const allParts = useMemo<Part[]>(() => parts ?? [], [parts]);
  const selectedParts = useMemo<Part[]>(() => {
    if (!parts) return [];
    const idSet = new Set(selectedPartIds);
    return parts.filter((p) => idSet.has(p.id));
  }, [parts, selectedPartIds]);

  const hasSelection = selectedParts.length > 0;

  // 다중 선택 시: 모두 같은 값일 때만 표시. 아니면 mixed.
  // 선택이 없으면 빈 배열 → 0/'' 기본값. UI 는 disabled 로 노출.
  const sharedX = sharedNumber(selectedParts, (p) => (p.transform ?? DEFAULT_TRANSFORM).x);
  const sharedY = sharedNumber(selectedParts, (p) => (p.transform ?? DEFAULT_TRANSFORM).y);
  const sharedRot = sharedNumber(
    selectedParts,
    (p) => (p.transform ?? DEFAULT_TRANSFORM).rotation,
  );
  // W/H — bounding_box × scale 로 표시. 편집 시 scale 을 역산해 적용.
  const sharedW = sharedNumber(
    selectedParts,
    (p) => p.bounding_box.width * (p.transform ?? DEFAULT_TRANSFORM).scaleX,
  );
  const sharedH = sharedNumber(
    selectedParts,
    (p) => p.bounding_box.height * (p.transform ?? DEFAULT_TRANSFORM).scaleY,
  );

  // 채우기 — 단일 선택이면 fill 객체 그대로 (그라디언트/패턴 편집 가능),
  // 다중 선택이면 모두 같을 때만 객체 유지, 그 외엔 mixed 로 표시.
  // sharedFill.value 는 swatch 미리보기 + 라벨에, sharedFill.mixed 는 '혼합' 표기에 사용.
  const sharedFill = sharedFillValue(selectedParts);
  const sharedStroke = sharedString(selectedParts, (p) => p.stroke);
  // 굵기 — 일러스트레이터처럼 확대하면 두꺼워지고 축소하면 얇아져 보이도록
  // stroke_width × scale 로 표시한다. Konva Path 는 strokeScaleEnabled=true 라
  // 캔버스 렌더 두께도 stroke_width × scale 이므로 표시값과 실제 두께가 일치한다.
  // (W/H 가 bounding_box × scale 로 표시·역산되는 것과 동일한 규약.)
  const sharedStrokeWidth = sharedNumber(
    selectedParts,
    (p) => p.stroke_width * effectiveScale(p.transform ?? DEFAULT_TRANSFORM),
  );

  // 파선 — 일러스트레이터식 [선분, 간격] 모델. 파선 on/off + 선분 길이 + 간격을 각각 노출.
  // 선분·간격도 굵기처럼 transform.scale 을 곱해 "보이는 길이" 로 표시 → 역산해 저장.
  // 다중 선택: 모두 켜져 있을 때만 checked. 하나라도 다르면 mixed(부분 선택) 취급.
  const dashOnCount = selectedParts.filter((p) => dashEnabled(p.stroke_dasharray)).length;
  const sharedDashOn = hasSelection && dashOnCount === selectedParts.length;
  const sharedDashMixed = dashOnCount > 0 && dashOnCount < selectedParts.length;
  const sharedDashLen = sharedNumber(
    selectedParts,
    (p) => dashLen(p.stroke_dasharray) * effectiveScale(p.transform ?? DEFAULT_TRANSFORM),
  );
  const sharedDashGap = sharedNumber(
    selectedParts,
    (p) => dashGap(p.stroke_dasharray) * effectiveScale(p.transform ?? DEFAULT_TRANSFORM),
  );
  const sharedLinecapStr = sharedString(selectedParts, (p) => p.stroke_linecap ?? 'butt');
  const sharedLinecap = sharedLinecapStr.value as StrokeLinecap;

  function setTransformAll(patch: Partial<Transform>) {
    for (const p of selectedParts) {
      const cur = p.transform ?? DEFAULT_TRANSFORM;
      updatePartTransform(p.id, { ...cur, ...patch });
    }
  }

  function setScaleFromW(w: number) {
    for (const p of selectedParts) {
      const cur = p.transform ?? DEFAULT_TRANSFORM;
      const bw = p.bounding_box.width || 1;
      updatePartTransform(p.id, { ...cur, scaleX: w / bw });
    }
  }
  function setScaleFromH(h: number) {
    for (const p of selectedParts) {
      const cur = p.transform ?? DEFAULT_TRANSFORM;
      const bh = p.bounding_box.height || 1;
      updatePartTransform(p.id, { ...cur, scaleY: h / bh });
    }
  }

  function applyStyleAll(patch: Parameters<typeof updatePartStyle>[1]) {
    for (const p of selectedParts) updatePartStyle(p.id, patch);
  }

  // 굵기 입력값은 "보이는 두께"(stroke_width × scale)다. scale 을 역산해
  // 베이스 stroke_width 로 환산해 저장 — W/H 가 scale 을 역산하는 것과 동일.
  function setStrokeWidthAll(displayWidth: number) {
    for (const p of selectedParts) {
      const s = effectiveScale(p.transform ?? DEFAULT_TRANSFORM);
      updatePartStyle(p.id, { stroke_width: displayWidth / s });
    }
  }

  // 파선 on/off 토글. 켜면 [선분, 간격] 기본 패턴(굵기×3)을 적용, 끄면 dasharray 해제(=실선).
  // 켤 때 이미 [선분,간격] 이 있으면 보존.
  function setDashEnabledAll(enabled: boolean) {
    for (const p of selectedParts) {
      if (!enabled) {
        updatePartStyle(p.id, { stroke_dasharray: null });
        continue;
      }
      if (dashEnabled(p.stroke_dasharray)) continue; // 이미 파선이면 패턴 보존
      const base = Math.max(p.stroke_width * 3, 3); // 기본 선분=간격=굵기×3
      updatePartStyle(p.id, { stroke_dasharray: [base, base] });
    }
  }

  // 선분 길이 입력(보이는 길이 = dash[0] × scale). scale 역산 후 dash[0] 만 교체, 간격은 보존.
  function setDashLenAll(displayLen: number) {
    for (const p of selectedParts) {
      const s = effectiveScale(p.transform ?? DEFAULT_TRANSFORM);
      const baseLen = displayLen / s;
      const gap = dashGap(p.stroke_dasharray);
      const fallbackGap = gap > 0 ? gap : Math.max(p.stroke_width * 3, 3);
      updatePartStyle(p.id, { stroke_dasharray: [Math.max(baseLen, 0), fallbackGap] });
    }
  }

  // 간격 입력(보이는 길이 = dash[1] × scale). scale 역산 후 dash[1] 만 교체, 선분은 보존.
  function setDashGapAll(displayGap: number) {
    for (const p of selectedParts) {
      const s = effectiveScale(p.transform ?? DEFAULT_TRANSFORM);
      const baseGap = displayGap / s;
      const len = dashLen(p.stroke_dasharray);
      const fallbackLen = len > 0 ? len : Math.max(p.stroke_width * 3, 3);
      updatePartStyle(p.id, { stroke_dasharray: [fallbackLen, Math.max(baseGap, 0)] });
    }
  }

  function setLinecapAll(cap: StrokeLinecap) {
    for (const p of selectedParts) updatePartStyle(p.id, { stroke_linecap: cap });
  }

  const isMulti = selectedParts.length >= 2;
  // 패턴 브러쉬는 단일 선택일 때만 적용/편집 가능(외곽선 섹션에 통합).
  const singlePart = hasSelection && !isMulti ? selectedParts[0]! : null;
  const hasBrushSel = !!singlePart?.brush;

  // 빈 선택 → "선택 없음", 단일 → 도형별 라벨, 다중 → "N <라벨>" / "N 선택됨".
  let titleLabel: string;
  if (!hasSelection) {
    titleLabel = '선택 없음';
  } else if (!isMulti) {
    titleLabel = getPartTypeLabel(selectedParts[0]!);
  } else {
    const firstLabel = getPartTypeLabel(selectedParts[0]!);
    const allSame = selectedParts.every((p) => getPartTypeLabel(p) === firstLabel);
    titleLabel = allSame
      ? `${selectedParts.length} ${firstLabel}`
      : `${selectedParts.length} 선택됨`;
  }

  // 채우기/외곽선 ColorRow — 선택이 있고 fill/stroke 가 'none' 이면 ColorRow 숨김.
  // (선택 없을 땐 위쪽의 hasSelection 가드로 섹션 자체가 안 보이므로 이 플래그는 hasSelection 전제.)
  const showFillRow = !(typeof sharedFill.value === 'string' && sharedFill.value === 'none');
  const showStrokeRow = sharedStroke.value !== 'none';

  // ColorRow 의 눈 아이콘 상태 — 선택 중 하나라도 표시(visible≠false)면 "표시"로 본다.
  // 클릭하면 toggleVisibility 가 모두 표시/모두 숨김을 알아서 토글.
  const anyVisible = selectedParts.some((p) => p.visible !== false);
  function toggleSelectedVisibility() {
    toggleVisibility(selectedPartIds);
  }

  return (
    <div>
      {/* 선택이 있을 때만 헤더+속성 섹션 노출. 선택이 없으면 헤더("선택 없음")와
          비활성화된 위치/레이아웃/외형/채우기/외곽선 섹션은 통째로 숨기고
          "내보내기" 섹션만 보여준다 — 캔버스 전체 export 는 선택과 무관히 의미가 있음. */}
      {hasSelection && (
        <>
      {/* 제목줄 — 단일/다중에 따라 도형별 라벨 표시 + 보조 아이콘 (figma refer4) */}
      <div
        className="px-3 h-9 flex items-center justify-between border-b"
        style={{ borderColor: 'hsl(var(--editor-border))' }}
      >
        <span
          className={[
            'text-[12px] font-semibold',
            hasSelection ? 'text-foreground' : 'text-[hsl(var(--editor-mute))]',
          ].join(' ')}
          style={{ letterSpacing: '-0.14px' }}
        >
          {titleLabel}
        </span>
        {isMulti && (
          <div className="flex items-center gap-0.5">
            <PathfinderTrigger ids={selectedPartIds} />
            <IconButton aria="컴포넌트 만들기" disabled>
              <Component size={12} strokeWidth={1.75} />
            </IconButton>
            <IconButton aria="더보기" disabled>
              <MoreHorizontal size={12} strokeWidth={1.75} />
            </IconButton>
          </div>
        )}
      </div>

      {/* 위치 ─ 정렬 / X·Y / 회전 */}
      <SectionHeader title="위치" />
      <div className="px-3 pt-1.5 pb-3 space-y-2">
        <AlignmentGrid />
        <div className="grid grid-cols-2 gap-1.5">
          <NumInput
            label="X"
            value={sharedX.value}
            mixed={sharedX.mixed}
            decimals={1}
            disabled={!hasSelection}
            onChange={(v) => setTransformAll({ x: v })}
          />
          <NumInput
            label="Y"
            value={sharedY.value}
            mixed={sharedY.mixed}
            decimals={1}
            disabled={!hasSelection}
            onChange={(v) => setTransformAll({ y: v })}
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <NumInput
            label="회전"
            unit="°"
            value={sharedRot.value}
            mixed={sharedRot.mixed}
            decimals={1}
            disabled={!hasSelection}
            onChange={(v) => setTransformAll({ rotation: v })}
          />
          <div />
        </div>
      </div>

      {/* 레이아웃 ─ W/H */}
      <SectionHeader title="레이아웃" />
      <div className="px-3 pt-1.5 pb-3">
        <div className="grid grid-cols-2 gap-1.5">
          <NumInput
            label="W"
            value={sharedW.value}
            mixed={sharedW.mixed}
            decimals={0}
            min={1}
            disabled={!hasSelection}
            onChange={(v) => setScaleFromW(v)}
          />
          <NumInput
            label="H"
            value={sharedH.value}
            mixed={sharedH.mixed}
            decimals={0}
            min={1}
            disabled={!hasSelection}
            onChange={(v) => setScaleFromH(v)}
          />
        </div>
      </div>

      {/* 외형 — figma는 불투명도/모서리 반경 자리. 현재 데이터 모델에 없으므로 placeholder. */}
      <SectionHeader
        title="외형"
        right={
          <div className="flex items-center gap-1">
            <IconButton aria="표시 토글" disabled>
              <Eye size={12} strokeWidth={1.75} />
            </IconButton>
            <IconButton aria="효과" disabled>
              <Droplet size={12} strokeWidth={1.75} />
            </IconButton>
          </div>
        }
      />
      <div className="px-3 pt-1.5 pb-3">
        <div className="grid grid-cols-2 gap-1.5">
          <NumInput label="불투명도" unit="%" value={100} disabled />
          <NumInput label="반경" value={0} disabled />
        </div>
      </div>

      {/* 채우기 — figma fill refer: 헤더 '+' 로 추가, 행의 눈/− 로 표시토글·제거.
          '+' 는 채우기가 없을 때만 노출(이미 있으면 추가 불가하니 숨김). */}
      <SectionHeader
        title="채우기"
        right={
          showFillRow ? null : (
            <IconButton
              aria="채우기 추가"
              disabled={!hasSelection}
              onClick={() => applyStyleAll({ fill: '#D9D9D9' })}
            >
              <Plus size={12} strokeWidth={1.75} />
            </IconButton>
          )
        }
      />
      {showFillRow && (
        <div className="px-3 pt-1.5 pb-3">
          <FillRow
            fill={sharedFill.value}
            mixed={sharedFill.mixed}
            disabled={!hasSelection}
            onChange={(v) => applyStyleAll({ fill: v })}
            visible={anyVisible}
            onToggleVisible={toggleSelectedVisibility}
            onRemove={() => applyStyleAll({ fill: 'none' })}
            bbox={selectedParts.length === 1 ? selectedParts[0].bounding_box : undefined}
          />
        </div>
      )}

      {/* 외곽선 — figma fill refer: 헤더 '+' 로 추가, 행의 눈/− 로 표시토글·제거.
          '+' 는 외곽선이 없을 때만 노출(이미 있으면 숨김). */}
      <SectionHeader
        title="외곽선"
        right={
          showStrokeRow ? null : (
            <IconButton
              aria="외곽선 추가"
              disabled={!hasSelection}
              onClick={() => applyStyleAll({ stroke: '#000000' })}
            >
              <Plus size={12} strokeWidth={1.75} />
            </IconButton>
          )
        }
      />
      {(showStrokeRow || singlePart) && (
        <div className="px-3 pt-1.5 pb-3 space-y-2">
          {showStrokeRow && (
            <ColorRow
              value={sharedStroke.value}
              mixed={sharedStroke.mixed}
              disabled={!hasSelection}
              onChange={(v) => applyStyleAll({ stroke: v })}
              visible={anyVisible}
              onToggleVisible={toggleSelectedVisibility}
              onRemove={() => applyStyleAll({ stroke: 'none' })}
            />
          )}
          {/* 굵기 — 브러쉬 적용 시엔 외곽선이 아니라 '브러쉬 두께'를 결정하므로
              외곽선 색(none)이어도 브러쉬가 있으면 노출한다. */}
          {(showStrokeRow || hasBrushSel) && (
            <div className="grid grid-cols-2 gap-1.5">
              <NumInput
                label="굵기"
                value={sharedStrokeWidth.value}
                mixed={sharedStrokeWidth.mixed}
                decimals={1}
                min={0}
                max={1000}
                disabled={!hasSelection}
                onChange={(v) => setStrokeWidthAll(v)}
              />
              <div />
            </div>
          )}
          {/* 파선 — 일러스트레이터식. 체크박스로 파선 사용 on/off, 켜면 선분·간격·캡 노출. */}
          {showStrokeRow && (
            <DashCheckbox
              checked={sharedDashOn}
              mixed={sharedDashMixed}
              onChange={(v) => setDashEnabledAll(v)}
            />
          )}
          {showStrokeRow && (sharedDashOn || sharedDashMixed) && (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                <NumInput
                  label="선분"
                  value={sharedDashLen.value}
                  mixed={sharedDashLen.mixed}
                  decimals={1}
                  min={0}
                  max={1000}
                  disabled={!hasSelection}
                  onChange={(v) => setDashLenAll(v)}
                />
                <NumInput
                  label="간격"
                  value={sharedDashGap.value}
                  mixed={sharedDashGap.mixed}
                  decimals={1}
                  min={0}
                  max={1000}
                  disabled={!hasSelection}
                  onChange={(v) => setDashGapAll(v)}
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <LinecapSelect
                  value={sharedLinecap}
                  mixed={sharedLinecapStr.mixed}
                  onChange={(c) => setLinecapAll(c)}
                />
                <div />
              </div>
            </>
          )}
          {/* 패턴 브러쉬 — 드롭다운으로 선택/해제. 크기는 위 '굵기'에 자동으로 맞춰진다. */}
          {singlePart && <BrushControl part={singlePart} />}
        </div>
      )}

        </>
      )}

      {/* 내보내기 — figma share refer2 스타일. + 로 행 추가, 행마다 scale × format × filename
          을 지정하고 하단 "내보내기" 버튼으로 모든 행을 차례로 다운로드.
          선택이 없으면 캔버스 전체를 대상으로 내보낸다. */}
      <ExportSection selectedParts={selectedParts} allParts={allParts} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 패턴 브러쉬 — 외곽선 섹션에 통합된 컨트롤. 일러스트레이터 레퍼런스 기준:
//  · 드롭다운은 브러쉬를 "선 미리보기"(패턴 스트로크) + 이름으로 표시 (pattern brush refer).
//  · 적용 시 가로/세로 뒤집기를 체크박스 + 방향 아이콘으로 노출 (패턴 브러쉬 옵션 refer2).
// 브러쉬 '크기'는 별도 입력 없이 외곽선 '굵기'(stroke_width)에 자동으로 맞춰진다.
// ─────────────────────────────────────────────────────────────────────────
function BrushControl({ part }: { part: Part }) {
  const sketch = useEditorStore((s) => s.sketch);
  const applyBrushToPart = useEditorStore((s) => s.applyBrushToPart);
  const removeBrushFromPart = useEditorStore((s) => s.removeBrushFromPart);
  const updatePartBrushParams = useEditorStore((s) => s.updatePartBrushParams);
  const expandBrush = useEditorStore((s) => s.expandBrush);

  const brushes = useMemo(() => allBrushes(sketch ?? null), [sketch]);
  const app = part.brush;
  const def = app ? findBrushDefinition(app.brush_id, sketch ?? null) : undefined;

  // 실효값 — 오버라이드(app) 우선, 없으면 정의(def) 기본값.
  const flipAlongVal = app?.flipAlong ?? def?.flipAlong ?? false;
  const flipAcrossVal = app?.flipAcross ?? def?.flipAcross ?? false;

  function patch(p: Partial<Omit<BrushApplication, 'brush_id'>>) {
    updatePartBrushParams(part.id, p);
  }

  return (
    <div className="space-y-1.5">
      {/* 패턴 브러쉬 드롭다운 — 선 미리보기 + 이름. '없음' 선택 시 브러쉬 해제. */}
      <BrushSelect
        brushes={brushes}
        value={app?.brush_id ?? null}
        currentDef={def ?? null}
        onChange={(id) =>
          id ? applyBrushToPart(id, part.id) : removeBrushFromPart(part.id)
        }
      />

      {app ? (
        <>
          {/* 뒤집기 — 가로(flipAlong) / 세로(flipAcross). refer2 의 체크박스 + 방향 아이콘. */}
          <div
            className="rounded border px-2 py-1.5 space-y-0.5"
            style={{ borderColor: 'hsl(var(--editor-border))' }}
          >
            <span
              className="block text-[10px] font-medium text-[hsl(var(--editor-mute))] uppercase mb-0.5"
              style={{ letterSpacing: '0.04em' }}
            >
              뒤집기
            </span>
            <FlipCheckbox
              label="가로로 뒤집기"
              checked={flipAlongVal}
              icon={<FlipHorizontal size={13} strokeWidth={1.75} />}
              onChange={() => patch({ flipAlong: !flipAlongVal })}
            />
            <FlipCheckbox
              label="세로로 뒤집기"
              checked={flipAcrossVal}
              icon={<FlipVertical size={13} strokeWidth={1.75} />}
              onChange={() => patch({ flipAcross: !flipAcrossVal })}
            />
          </div>

          {/* 확장 — 동적 타일을 실제 편집 가능한 패스로 베이킹. */}
          <button
            type="button"
            onClick={() => expandBrush(part.id)}
            className="w-full h-7 rounded border bg-white text-[12px] text-foreground hover:bg-black/[0.04] transition-colors"
            style={{
              fontWeight: 500,
              letterSpacing: '-0.14px',
              borderColor: 'hsl(var(--editor-border))',
            }}
          >
            확장
          </button>
        </>
      ) : null}
    </div>
  );
}

// 패턴 브러쉬 선택 드롭다운 (pattern brush refer). 트리거/목록 모두 브러쉬를 "선 미리보기"로
// 보여준다. native <select> 는 항목에 SVG 미리보기를 못 넣으므로 portal 팝오버로 직접 그린다.
function BrushSelect({
  brushes,
  value,
  currentDef,
  onChange,
}: {
  brushes: BrushDefinition[];
  value: string | null;
  currentDef: BrushDefinition | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const presets = brushes.filter((b) => b.source === 'preset');
  const userBrushes = brushes.filter((b) => b.source === 'user');
  const display = currentDef?.name ?? '기본';

  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: r.left, top: r.bottom + 4, width: r.width });
    setOpen(true);
  }

  // 외부 클릭 / Esc 로 닫기 (PathfinderTrigger 와 동일 패턴).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(id: string | null) {
    onChange(id);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="패턴 브러쉬"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="w-full flex items-center h-7 rounded border px-1.5 gap-1.5 bg-white hover:border-black/40 transition-colors"
        style={{ borderColor: open ? '#000' : 'hsl(var(--editor-border))' }}
      >
        <span className="flex-1 min-w-0 h-4 text-foreground">
          <BrushStrokePreview def={currentDef} />
        </span>
        <span
          className={[
            'text-[11px] truncate shrink-0 max-w-[88px]',
            currentDef ? 'text-foreground' : 'text-[hsl(var(--editor-mute))]',
          ].join(' ')}
          style={{ letterSpacing: '-0.14px' }}
          title={display}
        >
          {display}
        </span>
        <ChevronDown
          size={10}
          strokeWidth={2}
          className="text-[hsl(var(--editor-mute))] shrink-0"
        />
      </button>

      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            aria-label="패턴 브러쉬"
            className="fixed z-50 rounded-lg border bg-white shadow-xl py-1 max-h-72 overflow-y-auto"
            style={{
              left: pos.left,
              top: pos.top,
              width: pos.width,
              borderColor: 'hsl(var(--editor-border))',
            }}
          >
            <BrushOption
              label="기본"
              def={null}
              selected={value === null}
              onClick={() => pick(null)}
            />
            {presets.length > 0 && <BrushOptionGroup title="패턴 브러쉬" />}
            {presets.map((b) => (
              <BrushOption
                key={b.id}
                label={b.name}
                def={b}
                selected={value === b.id}
                onClick={() => pick(b.id)}
              />
            ))}
            {userBrushes.length > 0 && <BrushOptionGroup title="내 브러쉬" />}
            {userBrushes.map((b) => (
              <BrushOption
                key={b.id}
                label={b.name}
                def={b}
                selected={value === b.id}
                onClick={() => pick(b.id)}
              />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function BrushOptionGroup({ title }: { title: string }) {
  return (
    <div
      className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-medium text-[hsl(var(--editor-mute))] uppercase"
      style={{ letterSpacing: '0.04em' }}
    >
      {title}
    </div>
  );
}

function BrushOption({
  label,
  def,
  selected,
  onClick,
}: {
  label: string;
  def: BrushDefinition | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2.5 h-9 hover:bg-[hsl(var(--editor-hover))] transition-colors"
    >
      <span className="w-4 h-4 flex items-center justify-center shrink-0 text-foreground">
        {selected ? <Check size={12} strokeWidth={2.25} /> : null}
      </span>
      <span className="flex-1 min-w-0 h-5 text-foreground">
        <BrushStrokePreview def={def} />
      </span>
      <span
        className="text-[11px] text-foreground truncate shrink-0 max-w-[80px]"
        style={{ letterSpacing: '-0.14px' }}
        title={label}
      >
        {label}
      </span>
    </button>
  );
}

// 브러쉬를 가로 스트로크 한 줄로 미리보기. def=null 이면 '기본'(직선) 으로 표시(= 없음/plain).
// 타일을 충분히 반복해 viewBox 를 만들고 'slice' 로 높이에 맞춰 가로로 잘라 연속 패턴처럼 보이게 한다.
function BrushStrokePreview({ def }: { def: BrushDefinition | null }) {
  if (!def) {
    return (
      <svg
        aria-hidden="true"
        width="100%"
        height="100%"
        viewBox="0 0 100 16"
        preserveAspectRatio="none"
      >
        <line x1="3" y1="8" x2="97" y2="8" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }

  const tile = def.tiles.side;
  const repeat = 12;
  const w = tile.width;
  const h = tile.height;
  const stroke = !def.stroke || def.stroke === 'none' ? 'none' : def.stroke;
  const fill = !def.fill || def.fill === 'none' ? 'none' : def.fill;
  // baseline 정규화상 y 는 [-h/2, +h/2]. 약간 여백.
  const padY = h * 0.15;
  const vbY = -h / 2 - padY;
  const vbW = w * repeat;
  const vbH = h + padY * 2;

  return (
    <svg
      aria-hidden="true"
      width="100%"
      height="100%"
      viewBox={`0 ${vbY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid slice"
      className="text-foreground"
    >
      {Array.from({ length: repeat }, (_, i) => (
        <g key={i} transform={`translate(${i * w} 0)`}>
          {tile.paths.map((d, j) => (
            <path
              key={j}
              d={d}
              fill={fill}
              stroke={stroke === 'none' ? undefined : stroke}
              strokeWidth={def.stroke_width || 1}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

// 뒤집기 체크박스 (refer2) — 체크 사각형 + 라벨 + 방향 아이콘.
function FlipCheckbox({
  label,
  checked,
  icon,
  onChange,
}: {
  label: string;
  checked: boolean;
  icon: React.ReactNode;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      className="w-full flex items-center gap-2 h-6 text-foreground"
    >
      <span
        className={[
          'w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors',
          checked ? 'bg-black border-black text-white' : 'bg-white',
        ].join(' ')}
        style={{ borderColor: checked ? '#000' : 'hsl(var(--editor-border))' }}
      >
        {checked ? <Check size={9} strokeWidth={3} /> : null}
      </span>
      <span
        className="flex-1 text-left text-[11px]"
        style={{ letterSpacing: '-0.14px' }}
      >
        {label}
      </span>
      <span className="shrink-0 text-[hsl(var(--editor-mute))]">{icon}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 내보내기 (Export) 섹션 — figma_share_refer2 와 동일한 UI 구조
// ─────────────────────────────────────────────────────────────────────────
function makeDefaultRow(parts: Part[]): ExportRow {
  // 기본 파일명: 단일 선택이고 part.name 이 있으면 그 이름, 아니면 'export'.
  const base =
    parts.length === 1 && parts[0]?.name?.trim() ? parts[0]!.name!.trim() : 'export';
  return { scale: 1, format: 'PNG', filename: base };
}

function ExportSection({
  selectedParts,
  allParts,
}: {
  selectedParts: Part[];
  allParts: Part[];
}) {
  // 선택이 있으면 그 파트만, 없으면 캔버스 전체를 내보낸다.
  const exportParts = selectedParts.length > 0 ? selectedParts : allParts;
  const isAllCanvas = selectedParts.length === 0 && allParts.length > 0;

  const [rows, setRows] = useState<ExportRow[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function addRow() {
    setRows((prev) => [...prev, makeDefaultRow(exportParts)]);
  }
  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }
  function patchRow(idx: number, patch: Partial<ExportRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function runExport() {
    if (rows.length === 0 || exportParts.length === 0 || busy) return;
    setBusy(true);
    try {
      // 행마다 순차 처리 — 동시에 여러 다운로드를 띄우면 브라우저가 일부를 차단할 수 있다.
      for (const r of rows) {
        await exportPartsAs(exportParts, r);
      }
    } catch (err) {
      console.error('[export] failed', err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionHeader
        title="내보내기"
        right={
          <IconButton aria="내보내기 추가" onClick={addRow}>
            <Plus size={12} strokeWidth={1.75} />
          </IconButton>
        }
      />
      {rows.length > 0 && (
        <div className="px-3 pt-1.5 pb-3 space-y-2">
          {rows.map((row, idx) => (
            <ExportRowEditor
              key={idx}
              row={row}
              onPatch={(p) => patchRow(idx, p)}
              onRemove={() => removeRow(idx)}
            />
          ))}

          {/* 미리보기 토글 — 펼친 상태에서는 placeholder 박스만 보여줌 (raster 즉시 렌더는 비용↑) */}
          <button
            type="button"
            onClick={() => setPreviewOpen((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-[hsl(var(--editor-mute))] hover:text-foreground transition-colors"
            style={{ letterSpacing: '-0.14px' }}
          >
            {previewOpen ? (
              <ChevronDown size={11} strokeWidth={2} />
            ) : (
              <ChevronRight size={11} strokeWidth={2} />
            )}
            미리보기
          </button>
          {previewOpen && (
            <div
              className="h-20 rounded border flex items-center justify-center text-[10px] text-[hsl(var(--editor-mute))]"
              style={{
                borderColor: 'hsl(var(--editor-border))',
                backgroundImage:
                  'repeating-conic-gradient(#f3f4f6 0% 25%, white 0% 50%)',
                backgroundSize: '12px 12px',
              }}
            >
              {exportParts.length === 0
                ? '캔버스 비어있음'
                : isAllCanvas
                  ? `캔버스 전체 (${exportParts.length}개)`
                  : `${exportParts.length}개 파트`}
            </div>
          )}

          <button
            type="button"
            onClick={runExport}
            disabled={busy || exportParts.length === 0}
            className="w-full h-7 rounded bg-black text-white text-[12px] hover:bg-black/85 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            style={{ fontWeight: 500, letterSpacing: '-0.14px' }}
          >
            {busy
              ? '내보내는 중...'
              : `${isAllCanvas ? '전체 내보내기' : '내보내기'}${rows.length > 1 ? ` (${rows.length})` : ''}`}
          </button>
        </div>
      )}
    </>
  );
}

function ExportRowEditor({
  row,
  onPatch,
  onRemove,
}: {
  row: ExportRow;
  onPatch: (p: Partial<ExportRow>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <div className="flex-1 min-w-0">
          <SelectInput
            value={`${row.scale}x`}
            options={['0.5x', '1x', '2x', '3x', '4x']}
            onChange={(v) => onPatch({ scale: parseFloat(v.replace('x', '')) })}
          />
        </div>
        <div className="flex-1 min-w-0">
          <SelectInput
            value={row.format}
            options={['PNG', 'JPG', 'SVG']}
            onChange={(v) => onPatch({ format: v as ExportFormat })}
          />
        </div>
        <IconButton aria="더보기" disabled>
          <MoreHorizontal size={12} strokeWidth={1.75} />
        </IconButton>
        <IconButton aria="이 내보내기 제거" onClick={onRemove}>
          <Minus size={12} strokeWidth={1.75} />
        </IconButton>
      </div>
      <FilenameInput
        value={row.filename}
        format={row.format}
        scale={row.scale}
        onChange={(v) => onPatch({ filename: v })}
      />
    </div>
  );
}

// 파일명 단독 input — placeholder 로 최종 파일명 미리보기 (suffix + 확장자) 를 흐리게 보여준다.
function FilenameInput({
  value,
  format,
  scale,
  onChange,
}: {
  value: string;
  format: ExportFormat;
  scale: number;
  onChange: (v: string) => void;
}) {
  const ext = format === 'SVG' ? 'svg' : format === 'PNG' ? 'png' : 'jpg';
  const suffix = scale !== 1 ? `@${scale}x` : '';
  return (
    <label
      className="flex items-center h-7 rounded border px-1.5 gap-1 bg-white focus-within:border-black"
      style={{ borderColor: 'hsl(var(--editor-border))' }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="파일명"
        className="flex-1 min-w-0 w-full bg-transparent text-[11px] outline-none truncate"
        style={{ letterSpacing: '-0.14px' }}
      />
      <span
        className="text-[10px] text-[hsl(var(--editor-mute))] tabular-nums shrink-0"
        style={{ letterSpacing: '-0.14px' }}
      >
        {suffix}.{ext}
      </span>
    </label>
  );
}

// 파선 사용 체크박스 — 일러스트레이터 획 패널의 "파선" 토글. mixed(부분 선택)면 중간 표시.
function DashCheckbox({
  checked,
  mixed,
  onChange,
}: {
  checked: boolean;
  mixed?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : checked}
      onClick={() => onChange(mixed ? true : !checked)}
      className="w-full flex items-center gap-2 h-6 text-foreground"
    >
      <span
        className={[
          'w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors',
          checked || mixed ? 'bg-black border-black text-white' : 'bg-white',
        ].join(' ')}
        style={{ borderColor: checked || mixed ? '#000' : 'hsl(var(--editor-border))' }}
      >
        {mixed ? (
          <Minus size={9} strokeWidth={3} />
        ) : checked ? (
          <Check size={9} strokeWidth={3} />
        ) : null}
      </span>
      <span className="flex-1 text-left text-[11px]" style={{ letterSpacing: '-0.14px' }}>
        파선
      </span>
    </button>
  );
}

// 선 끝 캡 드롭다운 — butt/round/square. 점선이 켜져 있을 때만 노출됨.
function LinecapSelect({
  value,
  mixed,
  onChange,
}: {
  value: StrokeLinecap;
  mixed?: boolean;
  onChange: (c: StrokeLinecap) => void;
}) {
  const options: StrokeLinecap[] = ['butt', 'round', 'square'];
  return (
    <label
      className="relative flex items-center h-7 rounded border px-1.5 gap-1 bg-white focus-within:border-black cursor-pointer"
      style={{ borderColor: 'hsl(var(--editor-border))' }}
    >
      <span
        className="text-[10px] text-[hsl(var(--editor-mute))] uppercase font-medium shrink-0"
        style={{ letterSpacing: '0.04em' }}
      >
        끝
      </span>
      <span
        className={[
          'flex-1 min-w-0 text-[11px] truncate text-right',
          mixed ? 'text-[hsl(var(--editor-mute))]' : 'text-foreground',
        ].join(' ')}
        style={{ letterSpacing: '-0.14px' }}
      >
        {mixed ? '혼합' : LINECAP_LABELS[value]}
      </span>
      <ChevronDown
        size={10}
        strokeWidth={2}
        className="text-[hsl(var(--editor-mute))] shrink-0"
      />
      <select
        value={mixed ? '' : value}
        onChange={(e) => {
          const v = e.target.value as StrokeLinecap;
          if (v) onChange(v);
        }}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        {mixed && <option value="">혼합</option>}
        {options.map((c) => (
          <option key={c} value={c}>
            {LINECAP_LABELS[c]}
          </option>
        ))}
      </select>
    </label>
  );
}

// 작은 inline select — figma 스타일의 borderless 한 드롭다운처럼 보이게 native <select> 를 감싼다.
function SelectInput({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label
      className="relative flex items-center h-7 rounded border px-1.5 gap-1 bg-white focus-within:border-black cursor-pointer"
      style={{ borderColor: 'hsl(var(--editor-border))' }}
    >
      <span
        className="flex-1 min-w-0 text-[11px] truncate"
        style={{ letterSpacing: '-0.14px' }}
      >
        {value}
      </span>
      <ChevronDown
        size={10}
        strokeWidth={2}
        className="text-[hsl(var(--editor-mute))] shrink-0"
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 공통 UI 프리미티브
// ─────────────────────────────────────────────────────────────────────────
function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div
      className="px-3 h-8 flex items-center justify-between border-t"
      style={{ borderColor: 'hsl(var(--editor-border))' }}
    >
      <span
        className="text-[12px] font-semibold text-foreground"
        style={{ letterSpacing: '-0.14px' }}
      >
        {title}
      </span>
      {right}
    </div>
  );
}

function IconButton({
  children,
  aria,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  aria: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={aria}
      title={aria}
      disabled={disabled}
      onClick={onClick}
      className="w-6 h-6 flex items-center justify-center rounded text-[hsl(var(--editor-mute))] hover:bg-black/5 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}

// 라벨이 input 안 왼쪽에 회색으로 박힌 figma 스타일.
function NumInput({
  label,
  value,
  unit,
  mixed,
  decimals = 0,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  mixed?: boolean;
  decimals?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange?: (v: number) => void;
}) {
  const formatted = mixed
    ? '혼합'
    : `${roundDisplay(value, decimals)}${unit ?? ''}`;
  // 입력 중에는 controlled value를 매 키 입력마다 재포맷하면 "0.6" → "0." 같은
  // 중간 상태가 곧바로 0으로 삼켜져 0.x 단위 입력이 불가능해진다. 포커스 동안엔
  // 로컬 문자열 버퍼만 보여주고, blur/Enter 시점에 한 번만 파싱·커밋한다.
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 외부에서 value가 바뀌면(다른 파트 선택 등) 포커스 상태가 아닌 한 표시값을 동기화.
  useEffect(() => {
    if (draft !== null && document.activeElement !== inputRef.current) {
      setDraft(null);
    }
  }, [formatted, draft]);

  function commit(raw: string) {
    if (!onChange) return;
    const cleaned = raw.replace(/[^\d.\-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') {
      setDraft(null);
      return;
    }
    const n = Number(cleaned);
    if (!Number.isFinite(n)) {
      setDraft(null);
      return;
    }
    let next = n;
    if (typeof min === 'number' && next < min) next = min;
    if (typeof max === 'number' && next > max) next = max;
    onChange(next);
    setDraft(null);
  }

  return (
    <label
      className={[
        'flex items-center h-7 rounded border px-1.5 gap-1 transition-colors',
        disabled
          ? 'opacity-50 cursor-not-allowed bg-black/[0.02]'
          : 'bg-white focus-within:border-black',
      ].join(' ')}
      style={{ borderColor: 'hsl(var(--editor-border))' }}
    >
      <span
        className="text-[11px] text-[hsl(var(--editor-mute))] shrink-0"
        style={{ letterSpacing: '-0.14px' }}
      >
        {label}
      </span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draft ?? formatted}
        disabled={disabled || !onChange}
        onFocus={(e) => {
          if (!onChange) return;
          // 포커스 시점에 현재 표시값을 버퍼로 옮기고 전체선택 — 사용자가 곧바로
          // 새 값을 덮어쓰는 흔한 워크플로우를 자연스럽게 만든다.
          setDraft(mixed ? '' : `${roundDisplay(value, decimals)}`);
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => {
          if (!onChange) return;
          // 키 입력 동안에는 검증만 하고 그대로 두기 — "0.", "1.", "-" 등 중간 상태도
          // 받아둬야 0.x 단위 입력이 가능하다. 커밋은 blur/Enter에서.
          const raw = e.target.value.replace(/[^\d.\-]/g, '');
          setDraft(raw);
        }}
        onBlur={() => {
          if (draft === null) return;
          commit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (draft !== null) commit(draft);
            inputRef.current?.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(null);
            inputRef.current?.blur();
          }
        }}
        className="flex-1 min-w-0 w-full bg-transparent text-[11px] outline-none text-right tabular-nums"
        style={{ letterSpacing: '-0.14px' }}
      />
    </label>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label
      className="flex items-center h-7 rounded border px-1.5 gap-1 bg-white focus-within:border-black"
      style={{ borderColor: 'hsl(var(--editor-border))' }}
    >
      <span
        className="text-[11px] text-[hsl(var(--editor-mute))] shrink-0"
        style={{ letterSpacing: '-0.14px' }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 w-full bg-transparent text-[11px] outline-none"
        style={{ letterSpacing: '-0.14px' }}
      />
    </label>
  );
}

// 색상 swatch + hex + opacity. figma는 별도 opacity 슬라이더가 없으니 100% 고정 표시만.
function ColorRow({
  value,
  mixed,
  disabled,
  onChange,
  visible,
  onToggleVisible,
  onRemove,
}: {
  value: string;
  mixed: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
  // figma fill refer: 행 우측의 눈(표시 토글) + −(제거) 컨트롤. 모두 옵셔널 —
  // 넘기지 않으면 해당 버튼을 그리지 않는다(채우기/외곽선만 사용).
  visible?: boolean;
  onToggleVisible?: () => void;
  onRemove?: () => void;
}) {
  const isNone = value === 'none' || value === '';
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
  const display = mixed ? '혼합' : isNone ? '없음' : value.replace(/^#/, '').toUpperCase();

  return (
    <div
      className={[
        'flex items-center h-7 rounded border pr-0.5 transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed bg-black/[0.02]' : 'bg-white',
      ].join(' ')}
      style={{ borderColor: 'hsl(var(--editor-border))' }}
    >
      <div className="relative h-7 w-7 rounded-l overflow-hidden shrink-0">
        {isNone ? (
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(45deg, transparent 47%, #d1d5db 47%, #d1d5db 53%, transparent 53%)',
            }}
          />
        ) : mixed ? (
          // 혼합 — 흰 배경 위 좌하→우상 슬래시 한 줄로 "여러 색이 섞여 있음" 을 시사.
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-white"
            style={{
              backgroundImage:
                'linear-gradient(45deg, transparent 47%, #d1d5db 47%, #d1d5db 53%, transparent 53%)',
            }}
          />
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{ backgroundColor: hex }}
          />
        )}
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || isNone}
          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
          aria-label="색상"
        />
      </div>
      <input
        type="text"
        value={display}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value.trim();
          if (/^[0-9a-fA-F]{6}$/.test(v)) onChange(`#${v}`);
        }}
        className="flex-1 min-w-0 w-full h-7 bg-transparent px-2 text-[11px] outline-none tabular-nums disabled:cursor-not-allowed"
        style={{ letterSpacing: '-0.14px' }}
      />
      <span
        className="text-[11px] text-[hsl(var(--editor-mute))] tabular-nums px-1 shrink-0"
        style={{ letterSpacing: '-0.14px' }}
      >
        100 %
      </span>
      {/* 눈 — 표시/숨김 토글. visible=false 면 EyeOff. */}
      {onToggleVisible && (
        <IconButton
          aria={visible === false ? '표시' : '숨기기'}
          disabled={disabled}
          onClick={onToggleVisible}
        >
          {visible === false ? (
            <EyeOff size={12} strokeWidth={1.75} />
          ) : (
            <Eye size={12} strokeWidth={1.75} />
          )}
        </IconButton>
      )}
      {/* − 제거 — 채우기/외곽선 색을 'none' 으로. */}
      {onRemove && (
        <IconButton aria="제거" disabled={disabled} onClick={onRemove}>
          <Minus size={12} strokeWidth={1.75} />
        </IconButton>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Pathfinder — figma_refer5 스타일 드롭다운. 헤더 우측 IconButton 으로 트리거.
// 5개 액션: Unite(합집합) / Subtract(차집합) / Intersect(교집합) / Exclude(배제) / Divide(분할).
// ─────────────────────────────────────────────────────────────────────────
function PathfinderTrigger({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const unitePaths = useEditorStore((s) => s.unitePaths);
  const subtractPaths = useEditorStore((s) => s.subtractPaths);
  const intersectPaths = useEditorStore((s) => s.intersectPaths);
  const excludePaths = useEditorStore((s) => s.excludePaths);
  const dividePaths = useEditorStore((s) => s.dividePaths);

  // 트리거 좌표 계산 — 버튼 우측 정렬, 바로 아래 4px gap.
  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const POP_W = 192;
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - POP_W - 8, r.right - POP_W)),
      top: r.bottom + 4,
    });
    setOpen(true);
  }

  // 외부 클릭 / Esc 로 닫기.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items: {
    key: string;
    label: string;
    shortcut?: string;
    icon: React.ReactNode;
    onSelect: () => void;
  }[] = [
    {
      key: 'unite',
      label: '합집합',
      shortcut: 'Ctrl+Shift+U',
      icon: <PathfinderIcon kind="unite" />,
      onSelect: () => unitePaths(ids),
    },
    {
      key: 'subtract',
      label: '차집합',
      icon: <PathfinderIcon kind="subtract" />,
      onSelect: () => subtractPaths(ids),
    },
    {
      key: 'intersect',
      label: '교집합',
      icon: <PathfinderIcon kind="intersect" />,
      onSelect: () => intersectPaths(ids),
    },
    {
      key: 'exclude',
      label: '배제',
      icon: <PathfinderIcon kind="exclude" />,
      onSelect: () => excludePaths(ids),
    },
    {
      key: 'divide',
      label: '분할',
      shortcut: 'Ctrl+Alt+Shift+U',
      icon: <PathfinderIcon kind="divide" />,
      onSelect: () => dividePaths(ids),
    },
  ];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="패스파인더"
        title="패스파인더"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={[
          'h-6 px-1 flex items-center gap-0.5 rounded transition-colors',
          open
            ? 'bg-black text-white'
            : 'text-[hsl(var(--editor-mute))] hover:bg-black/5 hover:text-foreground',
        ].join(' ')}
      >
        {/* figma_refer5 패스파인더 트리거 아이콘 — 좌측 채워진 원 + 우측 흰 원이 살짝 겹쳐 'Subtract' 모양의 크레센트. */}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="5.2" cy="7" r="3.2" fill="currentColor" />
          <circle
            cx="8.8"
            cy="7"
            r="3.2"
            fill={open ? '#000' : 'hsl(var(--editor-panel))'}
            stroke="currentColor"
            strokeWidth="1.1"
          />
        </svg>
        <ChevronDown size={10} strokeWidth={2} />
      </button>
      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popRef}
            role="menu"
            aria-label="패스파인더"
            className="fixed z-50 rounded-lg shadow-xl py-1.5"
            style={{
              left: pos.left,
              top: pos.top,
              width: 192,
              backgroundColor: '#2c2c2c',
              color: 'white',
            }}
          >
            {items.map((b) => (
              <button
                key={b.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  b.onSelect();
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 h-7 text-[12px] hover:bg-[#3a3a3a] transition-colors"
                style={{ letterSpacing: '-0.14px' }}
              >
                <span className="w-3.5 h-3.5 flex items-center justify-center text-white shrink-0">
                  {b.icon}
                </span>
                <span className="flex-1 text-left">{b.label}</span>
                {b.shortcut && (
                  <span className="text-[11px] text-white/55 tabular-nums shrink-0">
                    {b.shortcut}
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

// 5개 패스파인더 액션을 표현하는 14×14 인라인 SVG. 두 원(좌/우)이 살짝 겹친 표준 도식.
// 채움/외곽선 조합으로 "어느 영역이 결과에 포함되는가" 를 시각화.
function PathfinderIcon({
  kind,
}: {
  kind: 'unite' | 'subtract' | 'intersect' | 'exclude' | 'divide';
}) {
  const stroke = 'currentColor';
  const sw = 1.2;
  const fillC = 'currentColor';
  // 좌 원: c=(5,7) r=3, 우 원: c=(9,7) r=3 — 가로로 살짝 겹치는 표준 패스파인더 도식.
  const leftPath = 'M 5 4 A 3 3 0 1 0 5 10 A 3 3 0 1 0 5 4 Z';
  const rightPath = 'M 9 4 A 3 3 0 1 0 9 10 A 3 3 0 1 0 9 4 Z';

  if (kind === 'unite') {
    // 합집합 영역 전체 채움 — 두 원을 같은 winding 으로 그려 nonzero 룰에서 한 덩어리로 보이게.
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d={`${leftPath} ${rightPath}`} fill={fillC} fillOpacity={0.18} />
        <circle cx={5} cy={7} r={3} stroke={stroke} strokeWidth={sw} />
        <circle cx={9} cy={7} r={3} stroke={stroke} strokeWidth={sw} />
      </svg>
    );
  }
  if (kind === 'subtract') {
    // 좌측 원에서 우측 원이 잘려나간 모양 (= 좌 채움, 우 위에 흰색).
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx={5} cy={7} r={3} fill={fillC} fillOpacity={0.18} stroke={stroke} strokeWidth={sw} />
        <circle cx={9} cy={7} r={3} fill="white" stroke={stroke} strokeWidth={sw} />
      </svg>
    );
  }
  if (kind === 'intersect') {
    // 두 원의 교집합 영역만 채움.
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx={5} cy={7} r={3} stroke={stroke} strokeWidth={sw} fill="none" />
        <circle cx={9} cy={7} r={3} stroke={stroke} strokeWidth={sw} fill="none" />
        {/* 교집합 영역 = clipPath 로 좌측 원에 우측 원 마스크 적용 */}
        <defs>
          <clipPath id="pf-int-clip">
            <circle cx={9} cy={7} r={3} />
          </clipPath>
        </defs>
        <circle cx={5} cy={7} r={3} fill={fillC} fillOpacity={0.35} clipPath="url(#pf-int-clip)" />
      </svg>
    );
  }
  if (kind === 'exclude') {
    // 합집합 − 교집합 (즉 두 원 영역에서 가운데 겹친 부분만 비움). evenodd 로 표현.
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d={`${leftPath} ${rightPath}`}
          fill={fillC}
          fillOpacity={0.18}
          fillRule="evenodd"
        />
        <circle cx={5} cy={7} r={3} stroke={stroke} strokeWidth={sw} />
        <circle cx={9} cy={7} r={3} stroke={stroke} strokeWidth={sw} />
      </svg>
    );
  }
  // divide — 두 원 외곽선만 + 가운데 분할선 한 줄로 "조각으로 나뉘었음" 을 시사.
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx={5} cy={7} r={3} stroke={stroke} strokeWidth={sw} fill={fillC} fillOpacity={0.08} />
      <circle cx={9} cy={7} r={3} stroke={stroke} strokeWidth={sw} fill={fillC} fillOpacity={0.08} />
      <line x1={7} y1={4.2} x2={7} y2={9.8} stroke={stroke} strokeWidth={sw} />
    </svg>
  );
}

// 정렬 그리드 — 가로(left/h-center/right) + 세로(top/v-center/bottom). 분배 버튼은 figma 레퍼에서 빠짐.
function AlignmentGrid() {
  const alignParts = useEditorStore((s) => s.alignParts);
  const selectedPartIds = useEditorStore((s) => s.selectedPartIds);
  const canAlign = selectedPartIds.length >= 2;
  const items: { action: AlignAction; title: string; icon: React.ReactNode }[] = [
    {
      action: 'align-left',
      title: '왼쪽 정렬',
      icon: <AlignStartVertical size={12} strokeWidth={1.75} />,
    },
    {
      action: 'align-center-h',
      title: '가로 가운데',
      icon: <AlignCenterVertical size={12} strokeWidth={1.75} />,
    },
    {
      action: 'align-right',
      title: '오른쪽 정렬',
      icon: <AlignEndVertical size={12} strokeWidth={1.75} />,
    },
    {
      action: 'align-top',
      title: '위쪽 정렬',
      icon: <AlignStartHorizontal size={12} strokeWidth={1.75} />,
    },
    {
      action: 'align-middle-v',
      title: '세로 가운데',
      icon: <AlignCenterHorizontal size={12} strokeWidth={1.75} />,
    },
    {
      action: 'align-bottom',
      title: '아래쪽 정렬',
      icon: <AlignEndHorizontal size={12} strokeWidth={1.75} />,
    },
  ];
  return (
    <div className="grid grid-cols-6 gap-0.5">
      {items.map((b) => (
        <button
          key={b.action}
          type="button"
          title={b.title}
          aria-label={b.title}
          disabled={!canAlign}
          onClick={() => alignParts(b.action)}
          className="h-7 rounded flex items-center justify-center text-[hsl(var(--editor-mute))] hover:bg-black/5 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {b.icon}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────
// 비균일 스케일이라도 선 굵기는 스칼라 하나로 표현돼야 하므로 |scaleX|·|scaleY|
// 평균을 쓴다. editor-store 의 bakeStrokeIntoIdentity 와 동일한 규약 — 두 곳이
// 어긋나면 라이브러리 baking 전/후 두께가 달라진다.
function effectiveScale(t: Transform): number {
  const s = (Math.abs(t.scaleX) + Math.abs(t.scaleY)) / 2;
  return Number.isFinite(s) && s > 0 ? s : 1;
}

// ─────────────────────────────────────────────────────────────────────────
// 파선 (stroke-dasharray) 유틸 — 일러스트레이터식 [선분, 간격] 모델.
//   실선 : undefined / []
//   파선 : [dash(선분 길이), gap(간격)]
// ─────────────────────────────────────────────────────────────────────────
function dashEnabled(dash: number[] | undefined): boolean {
  return Array.isArray(dash) && dash.length > 0 && dash.some((v) => v > 0);
}

// 선분 길이 = 첫 칸.
function dashLen(dash: number[] | undefined): number {
  if (!dash || dash.length === 0) return 0;
  return dash[0] ?? 0;
}

// 간격 = 둘째 칸(없으면 첫 칸과 동일하게 본다).
function dashGap(dash: number[] | undefined): number {
  if (!dash || dash.length === 0) return 0;
  return dash[1] ?? dash[0] ?? 0;
}

const LINECAP_LABELS: Record<StrokeLinecap, string> = {
  butt: '맞끝',
  round: '둥근끝',
  square: '사각끝',
};

function sharedNumber(
  parts: Part[],
  pick: (p: Part) => number,
): { value: number; mixed: boolean } {
  if (parts.length === 0) return { value: 0, mixed: false };
  const first = pick(parts[0]);
  const allSame = parts.every((p) => Math.abs(pick(p) - first) < 1e-6);
  return { value: first, mixed: !allSame };
}
function sharedString(
  parts: Part[],
  pick: (p: Part) => string,
): { value: string; mixed: boolean } {
  if (parts.length === 0) return { value: '', mixed: false };
  const first = pick(parts[0]);
  const allSame = parts.every((p) => pick(p) === first);
  return { value: first, mixed: !allSame };
}

function roundDisplay(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '0';
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return decimals === 0 ? String(Math.round(rounded)) : rounded.toFixed(decimals);
}

// ─────────────────────────────────────────────────────────────────────────
// 채우기 — FillRow + GradientPopover (gradient refer.png)
// ─────────────────────────────────────────────────────────────────────────

// 다중 선택의 fill 평탄화. 단색끼리/그라디언트끼리 정확히 같으면 그 값을, 아니면 첫 값 + mixed=true.
// 같은지 비교는 JSON 직렬화로 단순 비교 (stops 등 객체 구조 포함).
function sharedFillValue(parts: Part[]): { value: PartFill; mixed: boolean } {
  if (parts.length === 0) return { value: 'none', mixed: false };
  const firstKey = fillKey(parts[0].fill);
  const allSame = parts.every((p) => fillKey(p.fill) === firstKey);
  return { value: parts[0].fill, mixed: !allSame };
}

function fillKey(fill: PartFill | undefined | null): string {
  if (fill === undefined || fill === null) return 'none';
  if (typeof fill === 'string') return fill;
  return JSON.stringify(fill);
}

// CSS gradient 문자열 — swatch / 미리보기 바에 사용.
function fillToCssBackground(fill: PartFill): string {
  if (typeof fill === 'string') {
    if (fill === 'none') return 'transparent';
    return fill;
  }
  if (fill.kind === 'linear') {
    const stops = fill.stops
      .map((s) => `${s.color} ${(s.offset * 100).toFixed(1)}%`)
      .join(', ');
    // SVG 좌표(y 아래) → CSS gradient 각도: (x2-x1, y2-y1) 벡터의 각.
    const dx = fill.x2 - fill.x1;
    const dy = fill.y2 - fill.y1;
    // CSS linear-gradient 각도: 위쪽이 0deg, 시계방향. SVG 의 atan2(dy, dx) 는 오른쪽이 0,
    // 시계방향(y↓) 이므로 90도 더하면 일치한다.
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    return `linear-gradient(${deg.toFixed(1)}deg, ${stops})`;
  }
  if (fill.kind === 'radial') {
    const stops = fill.stops
      .map((s) => `${s.color} ${(s.offset * 100).toFixed(1)}%`)
      .join(', ');
    return `radial-gradient(circle, ${stops})`;
  }
  // 패턴은 swatch 에서 평균색.
  return fillToCssColor(fill);
}

function fillTypeLabel(fill: PartFill): string {
  if (typeof fill === 'string') {
    if (fill === 'none') return '없음';
    return fill.replace(/^#/, '').toUpperCase();
  }
  if (fill.kind === 'linear') return '선형';
  if (fill.kind === 'radial') return '방사형';
  return '패턴';
}

// hex 정규화 — "abc" → "#aabbcc" 미지원, 6자리 hex 만. 알파(#rrggbbaa) 도 같이 인식.
function isHexColor(v: string): boolean {
  return /^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v);
}

function normalizeHex(v: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(v.trim());
  if (!m) return null;
  return `#${m[1]}${m[2] ?? ''}`;
}

// 단색 → 선형 그라디언트 변환 (편집 진입). 같은 색의 0%/100% 두 stop 만.
// 좌표는 part 의 bounding_box 를 가로지르는 세로축으로 잡는다 — 그렇지 않으면
// (0,0)~(0,1) 같은 1px 좌표가 device 공간에 떨어져 그라디언트가 사실상 단색처럼 보인다.
// bbox 가 없으면(다중 선택 등) 100×100 임시 박스로 폴백 — 적어도 그라디언트가 한 점에 압축되진 않게.
function solidToLinear(color: string, bbox?: { x: number; y: number; width: number; height: number }): LinearGradientFill {
  const base = isHexColor(color) ? normalizeHex(color)! : '#D9D9D9';
  const b = bbox ?? { x: 0, y: 0, width: 100, height: 100 };
  return {
    kind: 'linear',
    stops: [
      { offset: 0, color: base },
      { offset: 1, color: '#737373' },
    ],
    x1: b.x + b.width / 2,
    y1: b.y,
    x2: b.x + b.width / 2,
    y2: b.y + b.height,
  };
}

function linearToRadial(
  g: LinearGradientFill,
  bbox?: { x: number; y: number; width: number; height: number },
): RadialGradientFill {
  // 선형의 두 끝점 중심을 cx,cy 로, 두 점 거리의 절반을 r1 로 — 자연스러운 축 보존.
  // bbox 가 있으면 r1 의 최소값을 short-side/2 로 보정해 너무 작아지지 않게.
  const cx = (g.x1 + g.x2) / 2;
  const cy = (g.y1 + g.y2) / 2;
  const dx = g.x2 - g.x1;
  const dy = g.y2 - g.y1;
  const dist = Math.sqrt(dx * dx + dy * dy) / 2;
  const minR = bbox ? Math.min(bbox.width, bbox.height) / 4 : 1;
  return {
    kind: 'radial',
    stops: g.stops.map((s) => ({ ...s })),
    fx: cx,
    fy: cy,
    r0: 0,
    cx,
    cy,
    r1: Math.max(dist, minR),
  };
}

function radialToLinear(g: RadialGradientFill): LinearGradientFill {
  // 중심을 가로지르는 세로축으로 — cy±r1.
  return {
    kind: 'linear',
    stops: g.stops.map((s) => ({ ...s })),
    x1: g.cx,
    y1: g.cy - g.r1,
    x2: g.cx,
    y2: g.cy + g.r1,
  };
}

// 채우기 행. 단색·혼합·그라디언트 미리보기를 swatch 에 그리고, 클릭하면 GradientPopover 를 띄움.
// bbox: 단색→그라디언트 변환 시 좌표를 part 의 bbox 에 맞춰 잡기 위해 사용. 다중 선택 등으로
// 단일 bbox 가 없으면 undefined.
function FillRow({
  fill,
  mixed,
  disabled,
  onChange,
  visible,
  onToggleVisible,
  onRemove,
  bbox,
}: {
  fill: PartFill;
  mixed: boolean;
  disabled?: boolean;
  onChange: (v: PartFill) => void;
  visible?: boolean;
  onToggleVisible?: () => void;
  onRemove?: () => void;
  bbox?: { x: number; y: number; width: number; height: number };
}) {
  // open 상태는 store 로 — 캔버스 그라디언트 핸들의 표시 조건과 lifetime 을 공유한다.
  // part 드래그/변형 시 canvas-panel 이 store 를 false 로 닫아 popover·핸들이 같이 사라짐.
  const open = useEditorStore((s) => s.isGradientPanelOpen);
  const setGradientPanelOpen = useEditorStore((s) => s.setGradientPanelOpen);
  const setOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v;
    setGradientPanelOpen(next);
  };
  const swatchRef = useRef<HTMLButtonElement>(null);

  const isNone = typeof fill === 'string' && fill === 'none';
  const isObj = typeof fill === 'object' && fill !== null;
  const display = mixed ? '혼합' : fillTypeLabel(fill);
  const background = mixed
    ? 'linear-gradient(45deg, transparent 47%, #d1d5db 47%, #d1d5db 53%, transparent 53%)'
    : isNone
      ? 'linear-gradient(45deg, transparent 47%, #d1d5db 47%, #d1d5db 53%, transparent 53%)'
      : fillToCssBackground(fill);

  return (
    <div
      className={[
        'relative flex items-center h-7 rounded border pr-0.5 transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed bg-black/[0.02]' : 'bg-white',
      ].join(' ')}
      style={{ borderColor: 'hsl(var(--editor-border))' }}
    >
      <button
        ref={swatchRef}
        type="button"
        aria-label="채우기 편집"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="relative h-7 w-7 rounded-l overflow-hidden shrink-0 disabled:cursor-not-allowed"
        style={{ background, backgroundColor: isObj ? '#ffffff' : undefined }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex-1 min-w-0 w-full h-7 bg-transparent px-2 text-[11px] outline-none tabular-nums text-left truncate disabled:cursor-not-allowed"
        style={{ letterSpacing: '-0.14px' }}
      >
        {display}
      </button>
      <span
        className="text-[11px] text-[hsl(var(--editor-mute))] tabular-nums px-1 shrink-0"
        style={{ letterSpacing: '-0.14px' }}
      >
        100 %
      </span>
      {onToggleVisible && (
        <IconButton
          aria={visible === false ? '표시' : '숨기기'}
          disabled={disabled}
          onClick={onToggleVisible}
        >
          {visible === false ? (
            <EyeOff size={12} strokeWidth={1.75} />
          ) : (
            <Eye size={12} strokeWidth={1.75} />
          )}
        </IconButton>
      )}
      {onRemove && (
        <IconButton aria="제거" disabled={disabled} onClick={onRemove}>
          <Minus size={12} strokeWidth={1.75} />
        </IconButton>
      )}
      {open && !disabled && (
        <GradientPopover
          anchor={swatchRef.current}
          fill={mixed ? 'none' : fill}
          bbox={bbox}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// gradient refer.png 와 같은 채우기 편집 팝오버.
// 상단: Custom/Libraries 탭 + 닫기. 행: 채우기 타입 토글(단색/선형/방사형/이미지/패턴 — 활성은 셋).
// 그 아래: 그라디언트일 때 Linear/Radial 드롭다운 + reverse + 그라디언트 바 + Stops 리스트.
// 단색일 때: hex + opacity 만.
function GradientPopover({
  anchor,
  fill,
  bbox,
  onChange,
  onClose,
}: {
  anchor: HTMLElement | null;
  fill: PartFill;
  bbox?: { x: number; y: number; width: number; height: number };
  onChange: (v: PartFill) => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 우측 패널 왼쪽으로 280px 폭의 팝오버를 띄움 (Figma 와 동일한 위치).
  useEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const POP_W = 280;
    const left = Math.max(8, r.left - POP_W - 8);
    const top = Math.max(8, r.top - 8);
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (anchor?.contains(t)) return;
      // Konva Stage 내부(=캔버스의 그라디언트 핸들 swatch 등) 클릭은 닫지 않는다.
      // 캔버스 핸들 드래그 ↔ popover Stops 양방향 동기화를 실시간으로 보려면 둘 다 떠 있어야.
      // 사용자가 다른 part 를 선택하면 fill prop 이 바뀌어 popover 가 자체 재렌더.
      if (
        t instanceof Element &&
        (t.closest('.konvajs-content') ||
          t.closest('canvas') ||
          (t as HTMLElement).tagName === 'CANVAS')
      ) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  if (!pos) return null;

  const kind: 'solid' | 'linear' | 'radial' = (() => {
    if (typeof fill === 'string') return 'solid';
    if (fill.kind === 'linear') return 'linear';
    if (fill.kind === 'radial') return 'radial';
    return 'solid';
  })();

  // 타입 토글 — 단색↔그라디언트 변환은 stops 손실 없이 가능하도록 보존 정책 사용.
  // bbox 가 있으면 part 의 bounding_box 를 가로지르는 좌표로 잡아 그라디언트가 즉시 보이게.
  function switchKind(target: 'solid' | 'linear' | 'radial') {
    if (target === 'solid') {
      const css = typeof fill === 'string' ? fill : fillToCssColor(fill);
      onChange(css === 'none' ? '#D9D9D9' : css);
      return;
    }
    if (target === 'linear') {
      if (typeof fill !== 'string' && fill.kind === 'radial') {
        onChange(radialToLinear(fill));
        return;
      }
      const base = typeof fill === 'string' ? fill : fillToCssColor(fill);
      onChange(solidToLinear(base, bbox));
      return;
    }
    // radial
    if (typeof fill !== 'string' && fill.kind === 'linear') {
      onChange(linearToRadial(fill, bbox));
      return;
    }
    const base = typeof fill === 'string' ? fill : fillToCssColor(fill);
    onChange(linearToRadial(solidToLinear(base, bbox), bbox));
  }

  const node = (
    <div
      ref={popRef}
      className="fixed z-50 bg-white rounded-lg shadow-xl border w-[280px] select-none"
      style={{
        left: pos.left,
        top: pos.top,
        borderColor: 'hsl(var(--editor-border))',
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
      }}
    >
      {/* 헤더 — Custom/Libraries 탭 + + / × */}
      <div
        className="flex items-center h-9 px-2 border-b"
        style={{ borderColor: 'hsl(var(--editor-border))' }}
      >
        <button
          type="button"
          className="px-2 h-7 text-[12px] font-medium"
          style={{ letterSpacing: '-0.16px' }}
        >
          Custom
        </button>
        <button
          type="button"
          className="px-2 h-7 text-[12px] text-[hsl(var(--editor-mute))]"
          style={{ letterSpacing: '-0.16px' }}
        >
          Libraries
        </button>
        <div className="flex-1" />
        <IconButton aria="추가" onClick={() => {}}>
          <Plus size={12} strokeWidth={1.75} />
        </IconButton>
        <IconButton aria="닫기" onClick={onClose}>
          <X size={12} strokeWidth={1.75} />
        </IconButton>
      </div>

      {/* 채우기 타입 토글 row — 단색/선형/방사형 활성, 이미지/비디오는 placeholder */}
      <div
        className="flex items-center h-9 px-2 border-b gap-0.5"
        style={{ borderColor: 'hsl(var(--editor-border))' }}
      >
        <FillKindButton
          active={kind === 'solid'}
          onClick={() => switchKind('solid')}
          aria="단색"
          kind="solid"
        />
        <FillKindButton
          active={kind === 'linear'}
          onClick={() => switchKind('linear')}
          aria="선형 그라디언트"
          kind="linear"
        />
        <FillKindButton
          active={kind === 'radial'}
          onClick={() => switchKind('radial')}
          aria="방사형 그라디언트"
          kind="radial"
        />
        <FillKindButton active={false} onClick={() => {}} aria="이미지" kind="image" disabled />
        <FillKindButton active={false} onClick={() => {}} aria="비디오" kind="video" disabled />
        <div className="flex-1" />
        <span
          className="inline-flex items-center justify-center h-6 w-6 rounded-full"
          style={{ background: '#1f1f1f' }}
        />
      </div>

      {/* 본문 — 단색일 때 hex 입력, 그라디언트일 때 풀 편집 */}
      {kind === 'solid' ? (
        <SolidEditor fill={typeof fill === 'string' ? fill : '#D9D9D9'} onChange={onChange} />
      ) : (
        <GradientEditor
          fill={fill as LinearGradientFill | RadialGradientFill}
          onChange={onChange}
        />
      )}
    </div>
  );

  if (typeof window === 'undefined') return null;
  return createPortal(node, document.body);
}

function FillKindButton({
  active,
  onClick,
  aria,
  kind,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  aria: string;
  kind: 'solid' | 'linear' | 'radial' | 'image' | 'video';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={aria}
      title={aria}
      disabled={disabled}
      onClick={onClick}
      className={[
        'inline-flex items-center justify-center h-6 w-6 rounded',
        active ? 'bg-[hsl(var(--editor-hover))]' : 'hover:bg-[hsl(var(--editor-hover))]',
        disabled ? 'opacity-30 cursor-not-allowed' : '',
      ].join(' ')}
    >
      <FillKindIcon kind={kind} />
    </button>
  );
}

function FillKindIcon({ kind }: { kind: 'solid' | 'linear' | 'radial' | 'image' | 'video' }) {
  const stroke = 'currentColor';
  if (kind === 'solid') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="2" y="2" width="10" height="10" rx="1" stroke={stroke} strokeWidth={1.2} />
      </svg>
    );
  }
  if (kind === 'linear') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <defs>
          <linearGradient id="fk-l" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#000" stopOpacity="0.85" />
            <stop offset="1" stopColor="#000" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="10" height="10" rx="1" fill="url(#fk-l)" stroke={stroke} strokeWidth={1} />
      </svg>
    );
  }
  if (kind === 'radial') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <defs>
          <radialGradient id="fk-r" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#000" stopOpacity="0.85" />
            <stop offset="1" stopColor="#000" stopOpacity="0.1" />
          </radialGradient>
        </defs>
        <rect x="2" y="2" width="10" height="10" rx="1" fill="url(#fk-r)" stroke={stroke} strokeWidth={1} />
      </svg>
    );
  }
  if (kind === 'image') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="2" y="2" width="10" height="10" rx="1" stroke={stroke} strokeWidth={1.2} />
        <circle cx="5" cy="6" r="1" fill={stroke} />
        <path d="M2.5 11 L6 7.5 L9 10 L11.5 8 L11.5 11.5 L2.5 11.5 Z" fill={stroke} />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="2" width="10" height="10" rx="1" stroke={stroke} strokeWidth={1.2} />
      <path d="M6 5.5 L9.5 7 L6 8.5 Z" fill={stroke} />
    </svg>
  );
}

function SolidEditor({
  fill,
  onChange,
}: {
  fill: string;
  onChange: (v: PartFill) => void;
}) {
  const hex = isHexColor(fill) ? fill.replace(/^#/, '').toUpperCase().slice(0, 6) : 'D9D9D9';
  return (
    <div className="p-3 space-y-2">
      <div
        className="flex items-center h-7 rounded border pr-0.5"
        style={{ borderColor: 'hsl(var(--editor-border))' }}
      >
        <div className="relative h-7 w-7 rounded-l overflow-hidden shrink-0">
          <div className="absolute inset-0" style={{ background: `#${hex}` }} />
          <input
            type="color"
            value={`#${hex}`}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label="색상"
          />
        </div>
        <input
          type="text"
          defaultValue={hex}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (/^[0-9a-fA-F]{6}$/.test(v)) onChange(`#${v.toUpperCase()}`);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="flex-1 min-w-0 w-full h-7 bg-transparent px-2 text-[11px] outline-none tabular-nums"
          style={{ letterSpacing: '-0.14px' }}
        />
        <span
          className="text-[11px] text-[hsl(var(--editor-mute))] tabular-nums px-1 shrink-0"
          style={{ letterSpacing: '-0.14px' }}
        >
          100 %
        </span>
      </div>
    </div>
  );
}

function GradientEditor({
  fill,
  onChange,
}: {
  fill: LinearGradientFill | RadialGradientFill;
  onChange: (v: PartFill) => void;
}) {
  // 선택된 stop 인덱스는 store 공유 — 캔버스 핸들 바의 swatch 강조와 동기화된다.
  const selectedStop = useEditorStore((s) => s.selectedStopIndex);
  const setSelectedStop = useEditorStore((s) => s.setSelectedStopIndex);
  const barRef = useRef<HTMLDivElement>(null);
  const dragInfo = useRef<{ idx: number; pending: boolean } | null>(null);

  const isLinear = fill.kind === 'linear';

  // 정렬된 stop 인덱스 (offset 오름차순) — 미리보기·stops 리스트 모두 정렬된 순서로 표시.
  const sortedIdx = fill.stops
    .map((_, i) => i)
    .sort((a, b) => fill.stops[a].offset - fill.stops[b].offset);

  // CSS background — 미리보기 바.
  const cssBg = isLinear
    ? `linear-gradient(90deg, ${fill.stops
        .slice()
        .sort((a, b) => a.offset - b.offset)
        .map((s) => `${s.color} ${(s.offset * 100).toFixed(1)}%`)
        .join(', ')})`
    : `linear-gradient(90deg, ${fill.stops
        .slice()
        .sort((a, b) => a.offset - b.offset)
        .map((s) => `${s.color} ${(s.offset * 100).toFixed(1)}%`)
        .join(', ')})`;

  function applyStops(stops: Array<{ offset: number; color: string }>) {
    if (isLinear) {
      const f: LinearGradientFill = { ...fill, stops };
      onChange(f);
    } else {
      const f: RadialGradientFill = { ...fill, stops };
      onChange(f);
    }
  }

  function setStop(i: number, patch: { offset?: number; color?: string }) {
    const stops = fill.stops.map((s, k) =>
      k === i ? { ...s, ...patch } : { ...s },
    );
    applyStops(stops);
  }

  function addStop() {
    // 인접 두 stop 의 중간 offset 에 stop 추가. 가장 큰 gap 자리 우선.
    const sorted = fill.stops
      .map((s, i) => ({ ...s, _i: i }))
      .sort((a, b) => a.offset - b.offset);
    let bestGap = 0;
    let bestOff = 0.5;
    let bestColor = sorted[0].color;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].offset - sorted[i].offset;
      if (gap > bestGap) {
        bestGap = gap;
        bestOff = (sorted[i].offset + sorted[i + 1].offset) / 2;
        bestColor = sorted[i].color;
      }
    }
    const stops = [...fill.stops.map((s) => ({ ...s })), { offset: bestOff, color: bestColor }];
    applyStops(stops);
    setSelectedStop(stops.length - 1);
  }

  function removeStop(i: number) {
    if (fill.stops.length <= 2) return; // 최소 2개 유지
    const stops = fill.stops.filter((_, k) => k !== i).map((s) => ({ ...s }));
    applyStops(stops);
    setSelectedStop(0);
  }

  function reverse() {
    const stops = fill.stops
      .map((s) => ({ offset: 1 - s.offset, color: s.color }))
      .sort((a, b) => a.offset - b.offset);
    applyStops(stops);
  }

  function changeKind(k: 'linear' | 'radial') {
    if (k === 'linear' && fill.kind === 'radial') onChange(radialToLinear(fill));
    if (k === 'radial' && fill.kind === 'linear') onChange(linearToRadial(fill));
  }

  // 드래그 — 바 위에서 stop 핸들을 좌우로 끌면 offset 변경.
  // 드래그 전체를 단일 undo 스텝으로 만든다 — 첫 move 의 pre-drag 스냅샷 직후 zundo 를
  // pause 하고, pointerup 에서 resume. 안 그러면 move 마다 스냅샷이 쌓여 Ctrl+Z 시
  // 조금씩 되돌아간다.
  function onPointerMove(e: PointerEvent) {
    const drag = dragInfo.current;
    const bar = barRef.current;
    if (!drag || !bar) return;
    const rect = bar.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setStop(drag.idx, { offset: t });
    if (drag.pending) {
      useTemporalStore.getState().pause();
      drag.pending = false;
    }
  }
  function onPointerUp() {
    dragInfo.current = null;
    useTemporalStore.getState().resume();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }
  function startDrag(idx: number, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragInfo.current = { idx, pending: true };
    setSelectedStop(idx);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  // 바 빈 곳 클릭 → 그 위치에 새 stop 추가.
  function onBarClick(e: React.MouseEvent) {
    if (e.target !== barRef.current) return;
    const rect = barRef.current!.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    // 가까운 두 stop 사이의 색 보간 (간단히 좌측 stop 색 채택).
    const sortedStops = fill.stops.slice().sort((a, b) => a.offset - b.offset);
    let color = sortedStops[0].color;
    for (let i = 0; i < sortedStops.length - 1; i++) {
      if (t >= sortedStops[i].offset && t <= sortedStops[i + 1].offset) {
        color = sortedStops[i].color;
        break;
      }
    }
    const stops = [...fill.stops.map((s) => ({ ...s })), { offset: t, color }];
    applyStops(stops);
    setSelectedStop(stops.length - 1);
  }

  return (
    <div className="p-3 space-y-3">
      {/* 타입 드롭다운 + reverse + (회전 placeholder) */}
      <div className="flex items-center gap-1.5">
        <select
          value={fill.kind}
          onChange={(e) => changeKind(e.target.value as 'linear' | 'radial')}
          className="flex-1 h-7 px-2 rounded border bg-white text-[11px] outline-none"
          style={{ borderColor: 'hsl(var(--editor-border))', letterSpacing: '-0.14px' }}
        >
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
        </select>
        <IconButton aria="반전" onClick={reverse}>
          <ArrowLeftRight size={12} strokeWidth={1.75} />
        </IconButton>
        <IconButton aria="회전" onClick={() => {}}>
          <RotateCw size={12} strokeWidth={1.75} />
        </IconButton>
      </div>

      {/* 그라디언트 바 + stop 핸들 */}
      <div
        ref={barRef}
        onClick={onBarClick}
        className="relative h-7 rounded border cursor-crosshair"
        style={{ background: cssBg, borderColor: 'hsl(var(--editor-border))' }}
      >
        {sortedIdx.map((i) => {
          const s = fill.stops[i];
          const isSel = i === selectedStop;
          // gradient refer: 사각형 + 아래 뾰족 꼬리 핀. 꼬리 끝이 바 안쪽을 가리켜
          // 어느 stop 이 어디에 매핑되는지 명확.
          return (
            <button
              key={i}
              type="button"
              onPointerDown={(e) => startDrag(i, e)}
              onDoubleClick={() => removeStop(i)}
              className="absolute -top-2.5 -translate-x-1/2 cursor-grab"
              style={{ left: `${s.offset * 100}%`, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))' }}
              aria-label={`stop ${i + 1}`}
            >
              <svg width="14" height="22" viewBox="0 0 14 22" style={{ display: 'block' }}>
                <path
                  d="M 1 1 H 13 V 14 L 7 20 L 1 14 Z"
                  fill={s.color}
                  stroke={isSel ? '#1e88e5' : '#ffffff'}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
                {/* 옅은 외곽선 — 흰색 배경 위에서도 핀 외곽이 보이도록 */}
                <path
                  d="M 1 1 H 13 V 14 L 7 20 L 1 14 Z"
                  fill="none"
                  stroke="rgba(0,0,0,0.25)"
                  strokeWidth={0.5}
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          );
        })}
      </div>

      {/* Stops 헤더 + 추가 */}
      <div className="flex items-center justify-between">
        <span
          className="text-[11px] font-medium"
          style={{ letterSpacing: '-0.14px' }}
        >
          Stops
        </span>
        <IconButton aria="stop 추가" onClick={addStop}>
          <Plus size={12} strokeWidth={1.75} />
        </IconButton>
      </div>

      {/* Stops 리스트 */}
      <div className="space-y-1">
        {sortedIdx.map((i) => {
          const s = fill.stops[i];
          const hex = isHexColor(s.color)
            ? s.color.replace(/^#/, '').toUpperCase().slice(0, 6)
            : 'D9D9D9';
          const offsetPct = Math.round(s.offset * 100);
          const isSel = i === selectedStop;
          return (
            <div
              key={i}
              onClick={() => setSelectedStop(i)}
              className={[
                'flex items-center h-7 rounded border pr-0.5 cursor-pointer transition-colors',
                isSel ? 'bg-[hsl(var(--editor-hover))]' : 'bg-white',
              ].join(' ')}
              style={{ borderColor: 'hsl(var(--editor-border))' }}
            >
              {/* key 에 offset 자체(소수점 4자리)를 포함 — 캔버스 swatch 드래그 시
                  매 갱신마다 새 mount 가 일어나 displayed % 가 따라간다.
                  defaultValue 유지로 사용자 typing 중간 cursor jump 방지. */}
              <input
                type="text"
                defaultValue={`${offsetPct}%`}
                key={`off-${i}-${s.offset.toFixed(4)}`}
                onBlur={(e) => {
                  const m = /^(\d{1,3})/.exec(e.target.value.trim());
                  if (!m) return;
                  const n = Math.max(0, Math.min(100, Number(m[1]))) / 100;
                  setStop(i, { offset: n });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className="w-10 h-7 bg-transparent px-2 text-[11px] outline-none tabular-nums"
                style={{ letterSpacing: '-0.14px' }}
              />
              <div className="relative h-7 w-7 shrink-0">
                {/* 시각 swatch 는 pointer-events-none — 아래 깔린 input[type=color] 이
                    클릭을 받아 OS color picker 가 열리도록. 누락하면 div 가 click 을
                    가로채 색 변경이 store 까지 도달하지 못한다. */}
                <div
                  className="absolute inset-1 rounded-sm border pointer-events-none"
                  style={{ background: s.color, borderColor: 'hsl(var(--editor-border))' }}
                />
                <input
                  type="color"
                  value={isHexColor(s.color) ? `#${hex}` : '#D9D9D9'}
                  onChange={(e) => setStop(i, { color: e.target.value.toUpperCase() })}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  aria-label="stop 색상"
                />
              </div>
              <input
                type="text"
                defaultValue={hex}
                key={`hex-${i}-${hex}`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (/^[0-9a-fA-F]{6}$/.test(v)) setStop(i, { color: `#${v.toUpperCase()}` });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className="flex-1 min-w-0 h-7 bg-transparent px-2 text-[11px] outline-none tabular-nums uppercase"
                style={{ letterSpacing: '-0.14px' }}
              />
              <span
                className="text-[11px] text-[hsl(var(--editor-mute))] tabular-nums px-1 shrink-0"
                style={{ letterSpacing: '-0.14px' }}
              >
                100 %
              </span>
              <IconButton
                aria="stop 제거"
                disabled={fill.stops.length <= 2}
                onClick={() => removeStop(i)}
              >
                <Minus size={12} strokeWidth={1.75} />
              </IconButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}
