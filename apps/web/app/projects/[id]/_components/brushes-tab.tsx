'use client';
// 좌측 패널의 '브러쉬' 탭 — 프리셋/사용자 브러쉬 카드 그리드 + SVG 반입.
// 카드 클릭 시 선택된 단일 파트에 브러쉬를 적용한다. (left-panel.tsx 에서만 import)

import { useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { useEditorStore } from '@/lib/editor-store';
import { allBrushes } from '@/lib/brush-lookup';
import { importBrushFromSvg } from '@/lib/brush-import';
import type { BrushDefinition } from '@sketchflat/svg-schema';

export function BrushesTab() {
  const sketch = useEditorStore((s) => s.sketch);
  const selectedPartIds = useEditorStore((s) => s.selectedPartIds);
  const applyBrushToPart = useEditorStore((s) => s.applyBrushToPart);
  const addUserBrush = useEditorStore((s) => s.addUserBrush);
  const removeUserBrush = useEditorStore((s) => s.removeUserBrush);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 단일 파트가 선택되어 있을 때만 적용 가능.
  const canApply = selectedPartIds.length === 1;

  const brushes = allBrushes(sketch ?? null);
  const presets = brushes.filter((b) => b.source === 'preset');
  const userBrushes = brushes.filter((b) => b.source === 'user');

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 같은 파일을 다시 선택해도 onChange 가 발화하도록 value 를 비운다.
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const def = importBrushFromSvg(text, {
        name: file.name.replace(/\.svg$/i, ''),
      });
      addUserBrush(def);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`SVG 브러쉬 반입에 실패했습니다.\n${msg}`);
    }
  }

  return (
    <div className="py-2">
      {/* SVG 브러쉬 반입 버튼 — LibraryTab 의 "에셋 추가" 버튼과 동일 스타일. */}
      <div className="px-3 pt-1 pb-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,image/svg+xml"
          onChange={handleFileChange}
          className="hidden"
          aria-hidden
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={[
            'w-full h-8 flex items-center justify-center gap-1.5 rounded border bg-white',
            'text-[12px] font-medium text-foreground',
            'hover:bg-[hsl(var(--editor-hover))] transition-colors',
          ].join(' ')}
          style={{
            borderColor: 'hsl(var(--editor-border))',
            letterSpacing: '-0.14px',
          }}
        >
          <Plus size={13} strokeWidth={1.75} />
          SVG 브러쉬 반입
        </button>
      </div>

      {/* 선택 안내 — 적용 대상이 없을 때 흐리게 안내. */}
      {!canApply ? (
        <p
          className="px-3 pb-2 text-[11px] text-[hsl(var(--editor-mute))] leading-relaxed"
          style={{ letterSpacing: '-0.14px' }}
        >
          적용할 패스를 먼저 선택하세요.
        </p>
      ) : null}

      <div className="px-3 flex flex-col gap-3">
        {presets.length > 0 ? (
          <BrushSection
            title="프리셋"
            brushes={presets}
            canApply={canApply}
            onApply={(id) => applyBrushToPart(id)}
          />
        ) : null}
        {userBrushes.length > 0 ? (
          <BrushSection
            title="내 브러쉬"
            brushes={userBrushes}
            canApply={canApply}
            onApply={(id) => applyBrushToPart(id)}
            onRemove={(id) => removeUserBrush(id)}
          />
        ) : null}
      </div>

      {brushes.length === 0 ? (
        <p
          className="text-[11px] text-[hsl(var(--editor-mute))] text-center mt-4 px-3"
          style={{ letterSpacing: '-0.14px' }}
        >
          사용 가능한 브러쉬가 없습니다.
        </p>
      ) : null}
    </div>
  );
}

// 카테고리 헤더(프리셋/사용자) + 카드 그리드. LibraryTab 의 카테고리 섹션 구조를 모방.
function BrushSection({
  title,
  brushes,
  canApply,
  onApply,
  onRemove,
}: {
  title: string;
  brushes: BrushDefinition[];
  canApply: boolean;
  onApply: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  return (
    <section>
      <h3
        className="text-[10px] font-medium text-[hsl(var(--editor-mute))] uppercase mb-1.5 px-0.5"
        style={{ letterSpacing: '0.04em' }}
      >
        {title}
      </h3>
      <ul className="grid grid-cols-2 gap-1.5">
        {brushes.map((def) => (
          <BrushCard
            key={def.id}
            def={def}
            canApply={canApply}
            onApply={() => onApply(def.id)}
            onRemove={onRemove ? () => onRemove(def.id) : undefined}
          />
        ))}
      </ul>
    </section>
  );
}

// 브러쉬 카드 — 타일 SVG 미리보기 + 이름. 클릭 시 선택 파트에 적용.
// 사용자 브러쉬는 hover 시 제거(X) 버튼 노출 (LibraryAssetCard 패턴).
function BrushCard({
  def,
  canApply,
  onApply,
  onRemove,
}: {
  def: BrushDefinition;
  canApply: boolean;
  onApply: () => void;
  onRemove?: () => void;
}) {
  return (
    <li>
      <div
        className="group/brush relative w-full flex flex-col gap-1 p-1.5 rounded border bg-white hover:bg-[hsl(var(--editor-hover))] transition-colors"
        style={{ borderColor: 'hsl(var(--editor-border))' }}
      >
        <button
          type="button"
          onClick={onApply}
          disabled={!canApply}
          aria-label={`${def.name} 적용`}
          title={canApply ? `${def.name} 적용` : '적용할 패스를 먼저 선택하세요'}
          className={[
            'aspect-[2/1] w-full rounded border bg-white overflow-hidden flex items-center justify-center',
            canApply ? '' : 'opacity-50 cursor-not-allowed',
          ].join(' ')}
          style={{ borderColor: 'hsl(var(--editor-border))' }}
        >
          <BrushTilePreview def={def} />
        </button>
        <p
          className="text-[11px] font-medium text-foreground truncate px-0.5"
          style={{ letterSpacing: '-0.14px' }}
          title={def.name}
        >
          {def.name}
        </p>
        {onRemove ? (
          <button
            type="button"
            aria-label={`${def.name} 제거`}
            title="제거"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className={[
              'absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded',
              'bg-white/95 border text-[hsl(var(--editor-mute))]',
              'opacity-0 group-hover/brush:opacity-100 hover:text-foreground transition-opacity',
            ].join(' ')}
            style={{ borderColor: 'hsl(var(--editor-border))' }}
          >
            <X size={10} strokeWidth={2} />
          </button>
        ) : null}
      </div>
    </li>
  );
}

// Side 타일 path 를 가로로 3회 반복해 패턴 느낌을 주는 인라인 SVG 미리보기.
// 타일-로컬 좌표(진행=+x, 법선=+y, baseline=y=0)를 그대로 사용하되,
// y 중앙이 0 이므로 viewBox 를 -height/2 부터 시작해 세로 중앙 정렬.
function BrushTilePreview({ def }: { def: BrushDefinition }) {
  const tile = def.tiles.side;
  const repeat = 3;
  const w = tile.width;
  const h = tile.height;
  const stroke = !def.stroke || def.stroke === 'none' ? 'none' : def.stroke;
  const fill = !def.fill || def.fill === 'none' ? 'none' : def.fill;
  // baseline 정규화상 y 는 [-h/2, +h/2] 범위. 약간의 여백을 둔다.
  const padY = h * 0.15;
  const vbX = 0;
  const vbY = -h / 2 - padY;
  const vbW = w * repeat;
  const vbH = h + padY * 2;

  return (
    <svg
      aria-hidden="true"
      width="100%"
      height="100%"
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
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
