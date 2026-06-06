'use client';
// 캔버스 위에 떠 있는 도구 팔레트. activeTool을 구독하고 단축키(V/A/P/H/Z 등)를 처리.
// figma 레퍼런스(figma_floating bar_refer.png)에 맞춰 각 툴 우측에 chevron-down을 둔다.
// 사각형·원은 하나의 그룹("도형")으로 묶여 화살표 클릭 시 다른 도형을 선택할 수 있다.

import { Fragment, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Circle,
  Frame,
  Hand,
  MousePointer,
  MousePointer2,
  PenTool,
  Pipette,
  Square,
  ZoomIn,
} from 'lucide-react';
import { useEditorStore, type EditorTool } from '@/lib/editor-store';

// AI 생성 버튼 아이콘 — 바탕화면 'icon refer.png' 레퍼런스 모양.
// 오목한 곡선 변을 가진 큰 4꼭짓점 sparkle + 좌상단 작은 별. lucide에 동일 모양이 없어
// 직접 path로 그린다. fill=currentColor 라 활성(검정 배경)에서는 흰색으로 반전된다.
function GenerateIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className={className}
      aria-hidden="true"
    >
      {/* 큰 별: viewBox 정중앙(12,12), 반경 10, 오목 곡선(웨이스트 0.45r) — 큰 별 기준 가운데 정렬 */}
      <path d="M12 2 C12 7.5 7.5 12 2 12 C7.5 12 12 16.5 12 22 C12 16.5 16.5 12 22 12 C16.5 12 12 7.5 12 2 Z" />
      {/* 작은 별: 좌상단 코너(3.5,3.3), 반경 2.8 */}
      <path d="M3.5 0.5 C3.5 2.04 2.24 3.3 0.7 3.3 C2.24 3.3 3.5 4.56 3.5 6.1 C3.5 4.56 4.76 3.3 6.3 3.3 C4.76 3.3 3.5 2.04 3.5 0.5 Z" />
    </svg>
  );
}

type ToolDef = {
  tool: EditorTool;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
};

// 그룹 = 같은 슬롯을 공유하는 툴 묶음. 첫 항목이 기본값.
// 단일 툴 그룹도 시각 통일을 위해 chevron을 노출하지만, 메뉴에는 항목이 1개만 들어간다.
const TOOL_GROUPS: ToolDef[][] = [
  [
    { tool: 'select', label: '선택', shortcut: 'V', icon: <MousePointer2 size={20} strokeWidth={1.25} /> },
  ],
  [
    { tool: 'direct-select', label: '직접 선택', shortcut: 'A', icon: <MousePointer size={20} strokeWidth={1.25} /> },
  ],
  [
    { tool: 'pen', label: '펜', shortcut: 'P', icon: <PenTool size={20} strokeWidth={1.25} /> },
  ],
  [
    { tool: 'eyedropper', label: '스포이드', shortcut: 'I', icon: <Pipette size={20} strokeWidth={1.25} /> },
  ],
  // 도형 그룹 — 사각형(R)이 기본, 화살표로 원(O) 전환.
  [
    { tool: 'rect', label: '사각형', shortcut: 'R', icon: <Square size={20} strokeWidth={1.25} /> },
    { tool: 'ellipse', label: '원', shortcut: 'O', icon: <Circle size={20} strokeWidth={1.25} /> },
  ],
  [
    { tool: 'artboard', label: '대지', shortcut: 'M', icon: <Frame size={20} strokeWidth={1.25} /> },
  ],
  [
    { tool: 'pan', label: '패닝', shortcut: 'H', icon: <Hand size={20} strokeWidth={1.25} /> },
  ],
  [
    { tool: 'zoom', label: '돋보기', shortcut: 'Z', icon: <ZoomIn size={20} strokeWidth={1.25} /> },
  ],
];

export function FloatingToolbar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  // Sparkle(AI 생성) 버튼 — 실제 EditorTool 이 아니라 image input 패널 토글 전용.
  // activeTool 을 건드리지 않아 캔버스 커서는 기본 유지.
  const imageInputOpen = useEditorStore((s) => s.imageInputOpen);
  const setImageInputOpen = useEditorStore((s) => s.setImageInputOpen);
  const toggleImageInput = useEditorStore((s) => s.toggleImageInput);

  // 생성도구(Sparkle)가 켜져 있는 동안엔 일반 툴(선택/직접선택 등) 활성 강조를 끈다 —
  // 초기 진입(imageInputOpen=true + activeTool='select')에서 두 칸이 동시에 검정으로
  // 보이던 회귀를 막기 위함. 사용자가 일반 툴을 클릭하면 Sparkle 을 같이 닫아 시각/상태가 어긋나지 않게 한다.
  const selectTool = (tool: EditorTool) => {
    setActiveTool(tool);
    if (imageInputOpen) setImageInputOpen(false);
  };

  // 각 그룹별로 마지막에 선택된 툴 — 메뉴에서 다른 도형을 고르면 슬롯 아이콘이 그것으로 전환된다.
  // activeTool 이 그룹 안의 툴로 바뀌면 자동으로 갱신해 단축키(R/O 등)도 슬롯에 반영된다.
  const [groupSelection, setGroupSelection] = useState<Record<number, EditorTool>>(() => {
    const init: Record<number, EditorTool> = {};
    TOOL_GROUPS.forEach((g, i) => {
      init[i] = g[0].tool;
    });
    return init;
  });

  useEffect(() => {
    const idx = TOOL_GROUPS.findIndex((g) => g.some((t) => t.tool === activeTool));
    if (idx < 0) return;
    setGroupSelection((prev) =>
      prev[idx] === activeTool ? prev : { ...prev, [idx]: activeTool },
    );
  }, [activeTool]);

  // 펼쳐진 그룹 인덱스. null = 모두 닫힘. 'ai' = Sparkle(AI 생성) 메뉴.
  const [openGroupIdx, setOpenGroupIdx] = useState<number | 'ai' | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 / Esc 로 메뉴 닫기.
  useEffect(() => {
    if (openGroupIdx === null) return;
    function onPointer(e: PointerEvent) {
      if (!toolbarRef.current) return;
      if (!toolbarRef.current.contains(e.target as Node)) setOpenGroupIdx(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenGroupIdx(null);
    }
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [openGroupIdx]);

  // V/A/P/H/Z/R/O/M 단축키 — 입력 필드 포커스 중엔 무시.
  // 단축키로 일반 툴을 선택해도 selectTool 을 거쳐 imageInputOpen 이 같이 닫힌다.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Shift 조합은 도구 단축키가 아니다 (예: Shift+R=눈금자, Shift+H=좌우반전). 단일 키만 처리.
      if (e.shiftKey) return;
      if (isEditableTarget(e.target)) return;
      const pick = (tool: EditorTool) => {
        e.preventDefault();
        setActiveTool(tool);
        if (useEditorStore.getState().imageInputOpen) {
          useEditorStore.getState().setImageInputOpen(false);
        }
      };
      if (e.code === 'KeyV') pick('select');
      else if (e.code === 'KeyA') pick('direct-select');
      else if (e.code === 'KeyP') pick('pen');
      else if (e.code === 'KeyI') pick('eyedropper');
      else if (e.code === 'KeyR') pick('rect');
      else if (e.code === 'KeyO') pick('ellipse');
      else if (e.code === 'KeyM') pick('artboard');
      else if (e.code === 'KeyH') pick('pan');
      // 단축키 Z. Cmd/Ctrl+Z(undo)는 위에서 mod 분기로 미리 걸러져 여기까지 안 옴.
      else if (e.code === 'KeyZ') pick('zoom');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setActiveTool]);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center z-20"
      role="toolbar"
      aria-label="에디터 도구"
    >
      <div
        ref={toolbarRef}
        className="pointer-events-auto h-12 flex items-center gap-0.5 px-2 rounded-xl bg-white border shadow-md"
        style={{ borderColor: 'hsl(var(--editor-border))' }}
      >
        {/* Sparkle(AI 생성) — 툴바 제일 왼쪽. 단축키 없음, activeTool 미변경.
            image input 패널의 노출 토글 전용. active 시각은 imageInputOpen 기준.
            다른 툴과 시각 통일을 위해 우측에 chevron + 단일 항목 메뉴를 둔다. */}
        {(() => {
          const aiOpen = openGroupIdx === 'ai';
          return (
            <div className="relative h-10 flex items-center">
              <button
                title="AI 생성"
                aria-label="AI 생성"
                aria-pressed={imageInputOpen}
                onClick={toggleImageInput}
                className="w-9 h-10 rounded-md flex items-center justify-center transition-colors hover:bg-black/5"
              >
                <span
                  className={[
                    'w-8 h-8 rounded flex items-center justify-center',
                    imageInputOpen ? 'bg-black text-white' : 'text-foreground',
                  ].join(' ')}
                >
                  {/* icon refer.png 레퍼런스 모양. fill=currentColor 라
                      활성: 흰 별 on 검정 / 비활성: 검정 별 on 흰 으로 자연 반전된다. */}
                  <GenerateIcon size={23} />
                </span>
              </button>
              <button
                aria-label="AI 생성 메뉴"
                aria-haspopup="menu"
                aria-expanded={aiOpen}
                onClick={() => setOpenGroupIdx(aiOpen ? null : 'ai')}
                className={[
                  'w-3.5 h-10 flex items-center justify-center rounded-md transition-colors',
                  aiOpen
                    ? 'bg-black/[0.06] text-foreground'
                    : 'text-[hsl(var(--editor-mute))] hover:text-foreground hover:bg-black/[0.04]',
                ].join(' ')}
              >
                <ChevronDown size={10} strokeWidth={1.75} />
              </button>

              {aiOpen ? (
                <div
                  role="menu"
                  aria-label="AI 생성 옵션"
                  className="absolute bottom-full left-0 mb-2 min-w-[160px] rounded-md border bg-white shadow-md py-1"
                  style={{ borderColor: 'hsl(var(--editor-border))' }}
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      setImageInputOpen(true);
                      setOpenGroupIdx(null);
                    }}
                    className={[
                      'w-full h-8 px-2.5 flex items-center gap-2 text-[12px] transition-colors',
                      imageInputOpen
                        ? 'bg-black/[0.06] text-foreground font-medium'
                        : 'text-foreground/85 hover:bg-black/[0.04]',
                    ].join(' ')}
                    style={{ letterSpacing: '-0.14px' }}
                  >
                    <span
                      className={[
                        'w-5 flex items-center justify-center',
                        imageInputOpen
                          ? 'text-foreground'
                          : 'text-[hsl(var(--editor-mute))]',
                      ].join(' ')}
                    >
                      <GenerateIcon size={16} />
                    </span>
                    <span className="flex-1 text-left truncate">AI 생성</span>
                  </button>
                </div>
              ) : null}
            </div>
          );
        })()}
        {TOOL_GROUPS.map((group, idx) => {
          const currentTool = groupSelection[idx] ?? group[0].tool;
          const currentDef = group.find((t) => t.tool === currentTool) ?? group[0];
          // 생성도구가 켜져 있는 동안엔 어떤 일반 툴도 활성으로 표시하지 않는다.
          const isActive = !imageInputOpen && activeTool === currentTool;
          const isOpen = openGroupIdx === idx;
          return (
            <Fragment key={idx}>
            <div className="relative h-10 flex items-center">
              <button
                title={`${currentDef.label} (${currentDef.shortcut})`}
                aria-label={currentDef.label}
                aria-pressed={isActive}
                onClick={() => selectTool(currentDef.tool)}
                className="w-9 h-10 rounded-md flex items-center justify-center transition-colors hover:bg-black/5"
              >
                {/* hit area는 36x40 그대로지만 시각적 활성 배경은 32x32로 축소. */}
                <span
                  className={[
                    'w-8 h-8 rounded flex items-center justify-center',
                    isActive ? 'bg-black text-white' : 'text-foreground',
                  ].join(' ')}
                >
                  {currentDef.icon}
                </span>
              </button>
              <button
                aria-label={`${currentDef.label} 메뉴`}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                onClick={() => setOpenGroupIdx(isOpen ? null : idx)}
                className={[
                  'w-3.5 h-10 flex items-center justify-center rounded-md transition-colors',
                  isOpen
                    ? 'bg-black/[0.06] text-foreground'
                    : 'text-[hsl(var(--editor-mute))] hover:text-foreground hover:bg-black/[0.04]',
                ].join(' ')}
              >
                <ChevronDown size={10} strokeWidth={1.75} />
              </button>

              {isOpen ? (
                <div
                  role="menu"
                  aria-label={`${currentDef.label} 옵션`}
                  className="absolute bottom-full left-0 mb-2 min-w-[160px] rounded-md border bg-white shadow-md py-1"
                  style={{ borderColor: 'hsl(var(--editor-border))' }}
                >
                  {group.map((t) => {
                    const itemActive = !imageInputOpen && activeTool === t.tool;
                    return (
                      <button
                        key={t.tool}
                        role="menuitem"
                        onClick={() => {
                          selectTool(t.tool);
                          setGroupSelection((prev) => ({ ...prev, [idx]: t.tool }));
                          setOpenGroupIdx(null);
                        }}
                        className={[
                          'w-full h-8 px-2.5 flex items-center gap-2 text-[12px] transition-colors',
                          itemActive
                            ? 'bg-black/[0.06] text-foreground font-medium'
                            : 'text-foreground/85 hover:bg-black/[0.04]',
                        ].join(' ')}
                        style={{ letterSpacing: '-0.14px' }}
                      >
                        <span
                          className={[
                            'w-5 flex items-center justify-center',
                            itemActive
                              ? 'text-foreground'
                              : 'text-[hsl(var(--editor-mute))]',
                          ].join(' ')}
                        >
                          {t.icon}
                        </span>
                        <span className="flex-1 text-left truncate">{t.label}</span>
                        <span
                          className="label-mono text-[10px] text-[hsl(var(--editor-mute))]"
                          style={{ letterSpacing: '-0.1px' }}
                        >
                          {t.shortcut}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
