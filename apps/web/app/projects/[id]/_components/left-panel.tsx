'use client';
// 프로젝트명 헤더 + 레이어/라이브러리 탭. 더 이상 별도 TopBar가 없으므로 헤더 역할까지 겸함.

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileUp,
  Folder,
  Layers as LayersIcon,
  Lightbulb,
  Lock,
  Package,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Unlock,
  Users,
  X,
} from 'lucide-react';
import {
  useEditorStore,
  type JobStatus,
  type LibraryAsset,
  type PanelMode,
  type SaveStatus,
} from '@/lib/editor-store';
import type { Part } from '@sketchflat/svg-schema';
import { fillToCssColor } from '@sketchflat/svg-schema';
import {
  fetchLibraryCatalog,
  type LibraryCatalogEntry,
} from '@/lib/library-catalog';
import { BrushesTab } from './brushes-tab';
import { convertPdfToSvg } from '@/lib/ai-pdf-to-svg';

const TABS: { mode: PanelMode; label: string }[] = [
  { mode: 'layers', label: '레이어' },
  { mode: 'library', label: '에셋' },
  { mode: 'brushes', label: '브러쉬' },
];

interface LeftPanelProps {
  projectId: string;
  initialTitle: string;
}

export function LeftPanel({ projectId, initialTitle }: LeftPanelProps) {
  const panelMode = useEditorStore((s) => s.panelMode);
  const setPanelMode = useEditorStore((s) => s.setPanelMode);

  return (
    <aside
      className="w-60 flex flex-col shrink-0 border-r"
      style={{
        backgroundColor: 'hsl(var(--editor-panel))',
        borderColor: 'hsl(var(--editor-border))',
      }}
    >
      <ProjectHeader projectId={projectId} initialTitle={initialTitle} />

      {/* 탭바 — 활성 탭은 회색 박스로 표시 (밑줄 X). */}
      <div
        className="px-2 py-2 flex items-center gap-1 border-b shrink-0"
        style={{ borderColor: 'hsl(var(--editor-border))' }}
        role="tablist"
      >
        {TABS.map(({ mode, label }) => {
          const isActive = panelMode === mode;
          return (
            <button
              key={mode}
              role="tab"
              aria-selected={isActive}
              onClick={() => setPanelMode(mode)}
              className={[
                'h-7 px-2.5 rounded transition-colors',
                isActive
                  ? 'bg-black/[0.07] text-foreground'
                  : 'text-[hsl(var(--editor-mute))] hover:text-foreground hover:bg-black/[0.04]',
              ].join(' ')}
              style={{
                fontSize: '12px',
                fontWeight: isActive ? 600 : 500,
                letterSpacing: '-0.14px',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {panelMode === 'layers' ? (
          <LayersTab />
        ) : panelMode === 'brushes' ? (
          <BrushesTab />
        ) : (
          <LibraryTab />
        )}
      </div>
    </aside>
  );
}

function getJobLabel(status: JobStatus): string {
  switch (status) {
    case 'pending':
    case 'running':
      return '생성 중...';
    case 'done':
      return '완료';
    default:
      return '';
  }
}

function getSaveLabel(status: SaveStatus): string {
  switch (status) {
    case 'saving':
      return '저장 중...';
    case 'saved':
      return '저장됨';
    case 'error':
      return '저장 실패';
    default:
      return '';
  }
}

function ProjectHeader({
  projectId,
  initialTitle,
}: {
  projectId: string;
  initialTitle: string;
}) {
  const jobStatus = useEditorStore((s) => s.jobStatus);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const toggleUIMinimized = useEditorStore((s) => s.toggleUIMinimized);

  const [title, setTitle] = useState(initialTitle);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  async function commit() {
    const next = draft.trim();
    setIsEditing(false);
    if (next.length === 0 || next === title) {
      setDraft(title);
      return;
    }
    const prev = title;
    setTitle(next);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch (err) {
      console.error('[title save]', err);
      setTitle(prev);
      setDraft(prev);
    }
  }

  function cancel() {
    setDraft(title);
    setIsEditing(false);
  }

  const jobLabel = getJobLabel(jobStatus);
  const saveLabel = jobLabel || getSaveLabel(saveStatus);
  const isError = !jobLabel && saveStatus === 'error';

  return (
    <div
      className="border-b shrink-0"
      style={{ borderColor: 'hsl(var(--editor-border))' }}
    >
      {/* 상단 행 — 좌측 로고, 우측에 UI 최소화(패널 토글) 버튼. figma 라이브러리 패널처럼
          로고와 같은 높이(맨 윗줄)에 둔다. */}
      <div className="flex items-center justify-between">
        <LogoMenu />
        <button
          type="button"
          onClick={toggleUIMinimized}
          aria-label="UI 최소화"
          title="UI 최소화"
          className="mr-2 w-9 h-[33px] shrink-0 flex items-center justify-center rounded text-[hsl(var(--editor-mute))] hover:text-foreground hover:bg-black/[0.06] transition-colors"
        >
          <PanelLeft
            size={13}
            strokeWidth={1.75}
            style={{ transform: 'scaleX(1.3)' }}
          />
        </button>
      </div>
      <div className="px-2 pt-1.5 pb-2">
      <div className="flex items-center gap-1 min-w-0">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            className="flex-1 min-w-0 h-7 rounded bg-transparent px-1.5 text-[13px] text-foreground outline-none border focus:border-black"
            style={{
              fontWeight: 500,
              letterSpacing: '-0.2px',
              borderColor: 'hsl(var(--editor-border))',
            }}
            aria-label="프로젝트 이름"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(title);
              setIsEditing(true);
            }}
            className="flex-1 min-w-0 h-7 px-1.5 rounded text-[13px] truncate text-foreground text-left hover:bg-black/5 transition-colors"
            style={{ fontWeight: 500, letterSpacing: '-0.2px' }}
            title="이름 변경"
          >
            {title}
          </button>
        )}
      </div>
      {saveLabel ? (
        <p
          className={[
            'text-[10px] mt-1 px-1.5',
            isError ? 'text-red-600' : 'text-[hsl(var(--editor-mute))]',
          ].join(' ')}
          style={{ letterSpacing: '-0.1px' }}
        >
          {saveLabel}
        </p>
      ) : null}
      </div>
    </div>
  );
}

// 좌상단 로고 + 드롭다운 트리거 (둘이 하나의 사각 버튼). 파일 메뉴를 토글한다.
// editor-shell의 미니 헤더에서도 동일 컴포넌트를 재사용하므로 export.
export function LogoMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importExternalVector = useEditorStore((s) => s.importExternalVector);
  // 보기 메뉴용 — 눈금자/UI 토글 상태와 뷰포트 명령 디스패치.
  const showRuler = useEditorStore((s) => s.showRuler);
  const toggleRuler = useEditorStore((s) => s.toggleRuler);
  const hideUI = useEditorStore((s) => s.hideUI);
  const toggleHideUI = useEditorStore((s) => s.toggleHideUI);
  const toggleUIMinimized = useEditorStore((s) => s.toggleUIMinimized);
  const requestViewCommand = useEditorStore((s) => s.requestViewCommand);
  // 가져오기 진행/오류 상태 — 메뉴 안에 인라인 표시. pdfjs 로딩+파싱은 비동기라 피드백이 필요하다.
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // 현재 열린 플라이아웃 하위 메뉴 키 (참고 이미지의 ' >' 항목). 호버로 전환한다.
  const [openSub, setOpenSub] = useState<string | null>(null);

  // 메뉴가 닫히면 열린 하위 메뉴도 초기화한다.
  useEffect(() => {
    if (!open) setOpenSub(null);
  }, [open]);

  // 외부 클릭 / Esc로 닫기.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 선택한 파일을 SVG 문자열로 변환해 스케치에 흡수한다.
  // .svg → 그대로 텍스트. .ai/.pdf → pdfjs 로 벡터 경로 추출(원본 fill/stroke 보존).
  async function handleFile(file: File) {
    setImportError(null);
    setImporting(true);
    try {
      const lower = file.name.toLowerCase();
      const label = file.name.replace(/\.[^.]+$/, '') || '가져온 도식';
      let svg: string | null = null;
      if (lower.endsWith('.svg')) {
        svg = await file.text();
      } else if (lower.endsWith('.ai') || lower.endsWith('.pdf')) {
        const buf = await file.arrayBuffer();
        const result = await convertPdfToSvg(buf);
        svg = result?.svg ?? null;
        if (!svg) throw new Error('벡터 경로를 추출하지 못했습니다');
      } else {
        throw new Error('지원하지 않는 형식 (.ai, .pdf, .svg)');
      }
      importExternalVector(svg, label);
      setOpen(false);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : '가져오기 실패');
    } finally {
      setImporting(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 같은 파일 재선택 시에도 onChange 가 다시 불리도록 value 초기화.
    e.target.value = '';
    if (file) void handleFile(file);
  }

  return (
    <div
      ref={containerRef}
      className="relative px-2 py-1 flex items-center"
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="파일 메뉴"
        onClick={() => setOpen((v) => !v)}
        className={[
          'w-[44px] h-[33px] rounded flex items-center justify-center gap-1 transition-colors',
          open
            ? 'bg-black/[0.07] text-foreground'
            : 'text-foreground hover:bg-black/[0.06]',
        ].join(' ')}
      >
        {/* 로고 — 467x655(약 0.713) 세로형 비율 보존. 버튼 안에서 약 30% 작게. */}
        <Image
          src="/logo.png"
          alt="SketchFlat"
          width={13}
          height={18}
          priority
          className="shrink-0"
        />
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          className="text-[hsl(var(--editor-mute))]"
        />
      </button>

      {/* 숨김 파일 입력 — 메뉴 항목 클릭 시 프로그램적으로 연다. 일러스트레이터 .ai 와
          PDF, SVG 를 받는다. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".ai,.pdf,.svg,application/pdf,application/illustrator,image/svg+xml"
        className="hidden"
        onChange={onFileChange}
      />

      {open ? (
        // 다크 테마 메뉴 — logomenu_refer.png(Figma 메뉴)의 구조를 그대로 재현한다.
        // 실제 동작이 연결된 항목은 '파일 > 파일 가져오기'와 '파일로 돌아가기' 둘뿐이고,
        // 나머지 ' >' 항목은 구조 재현용 표시 항목(클릭 동작 없음)이다.
        <div
          role="menu"
          aria-label="파일 메뉴"
          className="absolute left-2 top-full mt-1 z-30 min-w-[208px] rounded-lg py-1.5 text-[#e8e8e8] shadow-[0_8px_28px_rgba(0,0,0,0.4)] ring-1 ring-white/[0.08]"
          style={{ backgroundColor: '#2b2b2b' }}
        >
          <Link
            href="/"
            role="menuitem"
            onMouseEnter={() => setOpenSub(null)}
            onClick={() => setOpen(false)}
            className="flex items-center px-3 h-8 text-[12px] hover:bg-white/[0.07] transition-colors"
            style={{ letterSpacing: '-0.14px' }}
          >
            파일로 돌아가기
          </Link>

          {/* 검색 행 — 참고 이미지처럼 별도 배경 박스 없이 메뉴 위에 평평하게. 팔레트
              기능이 없어 표시용이며, '파일로 돌아가기' 와 한 묶음이라 위 구분선은 없다. */}
          <div
            className="flex items-center gap-2.5 px-3 h-9"
            onMouseEnter={() => setOpenSub(null)}
          >
            <Search size={14} strokeWidth={1.75} className="shrink-0 text-[#8f8f8f]" />
            <span className="flex-1 text-[12px] text-[#8f8f8f]" style={{ letterSpacing: '-0.14px' }}>
              액션...
            </span>
            <span className="text-[11px] text-[#7a7a7a] tabular-nums">Ctrl+K</span>
          </div>

          <div className="my-1.5 h-px bg-white/[0.09]" />

          {/* 파일 — 유일하게 실제 하위 메뉴를 가진 항목. 호버하면 우측으로 플라이아웃이 뜬다. */}
          <div
            className="relative"
            onMouseEnter={() => setOpenSub('file')}
          >
            <MenuRow
              label="파일"
              active={openSub === 'file'}
              onClick={() => setOpenSub((v) => (v === 'file' ? null : 'file'))}
            />
            {openSub === 'file' ? (
              <div
                role="menu"
                aria-label="파일 하위 메뉴"
                className="absolute left-full top-0 -mt-1.5 ml-1 min-w-[220px] rounded-lg py-1.5 text-[#e8e8e8] shadow-[0_8px_28px_rgba(0,0,0,0.4)] ring-1 ring-white/[0.08]"
                style={{ backgroundColor: '#2b2b2b' }}
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={importing}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center gap-2 px-3 h-8 text-[12px] text-left hover:bg-white/[0.07] transition-colors disabled:opacity-50 disabled:cursor-default"
                  style={{ letterSpacing: '-0.14px' }}
                >
                  <FileUp size={13} strokeWidth={1.75} className="shrink-0 text-[#a0a0a0]" />
                  {importing ? '가져오는 중…' : '파일 가져오기 (.ai, .pdf, .svg)'}
                </button>
                {importError ? (
                  <p
                    className="px-3 py-1 text-[11px] text-red-400"
                    style={{ letterSpacing: '-0.1px' }}
                  >
                    {importError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <MenuRow label="편집" onMouseEnter={() => setOpenSub(null)} />

          {/* 보기 — 눈금자/UI/줌 항목을 가진 실제 하위 메뉴. (menu refer1 참고, 우리 단축키로 조정) */}
          <div className="relative" onMouseEnter={() => setOpenSub('view')}>
            <MenuRow
              label="보기"
              active={openSub === 'view'}
              onClick={() => setOpenSub((v) => (v === 'view' ? null : 'view'))}
            />
            {openSub === 'view' ? (
              <div
                role="menu"
                aria-label="보기 하위 메뉴"
                className="absolute left-full top-0 -mt-1.5 ml-1 min-w-[240px] rounded-lg py-1.5 text-[#e8e8e8] shadow-[0_8px_28px_rgba(0,0,0,0.4)] ring-1 ring-white/[0.08]"
                style={{ backgroundColor: '#2b2b2b' }}
              >
                <SubMenuItem
                  label="눈금자"
                  shortcut="Shift+R"
                  checked={showRuler}
                  onClick={() => { toggleRuler(); setOpen(false); }}
                />

                <div className="my-1.5 h-px bg-white/[0.09]" />

                <SubMenuItem
                  label="UI 최소화"
                  shortcut="Ctrl+Shift+\"
                  onClick={() => { toggleUIMinimized(); setOpen(false); }}
                />
                <SubMenuItem
                  label="UI 표시/숨기기"
                  shortcut="Ctrl+\"
                  checked={!hideUI}
                  onClick={() => { toggleHideUI(); setOpen(false); }}
                />

                <div className="my-1.5 h-px bg-white/[0.09]" />

                <SubMenuItem
                  label="확대"
                  shortcut="Ctrl++"
                  onClick={() => { requestViewCommand('zoom-in'); setOpen(false); }}
                />
                <SubMenuItem
                  label="축소"
                  shortcut="Ctrl+-"
                  onClick={() => { requestViewCommand('zoom-out'); setOpen(false); }}
                />
                <SubMenuItem
                  label="100%로 확대"
                  shortcut="Shift+0"
                  onClick={() => { requestViewCommand('zoom-100'); setOpen(false); }}
                />
                <SubMenuItem
                  label="화면에 맞게 축소/확대"
                  shortcut="Ctrl+0"
                  onClick={() => { requestViewCommand('zoom-fit'); setOpen(false); }}
                />
                <SubMenuItem
                  label="선택 영역 확대"
                  shortcut="Shift+2"
                  onClick={() => { requestViewCommand('zoom-selection'); setOpen(false); }}
                />
              </div>
            ) : null}
          </div>

          {['개체', '텍스트', '정렬'].map((label) => (
            <MenuRow key={label} label={label} onMouseEnter={() => setOpenSub(null)} />
          ))}

          <div className="my-1.5 h-px bg-white/[0.09]" />

          {['기본 설정'].map((label) => (
            <MenuRow key={label} label={label} onMouseEnter={() => setOpenSub(null)} />
          ))}
          <MenuRow label="라이브러리" chevron={false} onMouseEnter={() => setOpenSub(null)} />

          <div className="my-1.5 h-px bg-white/[0.09]" />

          <MenuRow label="도움말 및 계정" onMouseEnter={() => setOpenSub(null)} />
        </div>
      ) : null}
    </div>
  );
}

// LogoMenu 다크 메뉴의 일반 행 — 좌측 라벨 + (옵션) 우측 ' >' 셰브론. 참고 이미지의
// 하위 메뉴 항목 구조를 재현한다. active 는 하위 메뉴가 열린 상태의 하이라이트.
function MenuRow({
  label,
  chevron = true,
  active = false,
  onClick,
  onMouseEnter,
}: {
  label: string;
  chevron?: boolean;
  active?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={[
        'flex w-full items-center px-3 h-8 text-[12px] text-left transition-colors',
        active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.07]',
      ].join(' ')}
      style={{ letterSpacing: '-0.14px' }}
    >
      <span className="flex-1">{label}</span>
      {chevron ? (
        <ChevronRight size={13} strokeWidth={1.75} className="shrink-0 text-[#8f8f8f]" />
      ) : null}
    </button>
  );
}

// 하위 메뉴 항목 — 좌측 체크 슬롯(토글 항목) + 라벨 + 우측 단축키. menu refer1 구조 차용.
function SubMenuItem({
  label,
  shortcut,
  checked = false,
  onClick,
}: {
  label: string;
  shortcut?: string;
  checked?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-2.5 h-8 text-[12px] text-left hover:bg-white/[0.07] transition-colors"
      style={{ letterSpacing: '-0.14px' }}
    >
      <span className="flex w-3.5 shrink-0 justify-center">
        {checked ? <Check size={12} strokeWidth={2} className="text-[#e8e8e8]" /> : null}
      </span>
      <span className="flex-1">{label}</span>
      {shortcut ? (
        <span className="shrink-0 text-[11px] text-[#8a8a8a] tabular-nums">{shortcut}</span>
      ) : null}
    </button>
  );
}

// 레이어 패널 트리 노드 — 그룹 안에 그룹이 들어오는 중첩을 지원하기 위한 재귀 구조.
// 그룹 노드의 z 는 후손 파트 z_index 의 max — 같은 레벨 정렬에 사용된다.
type LayerNode =
  | { kind: 'part'; part: Part; depth: number }
  | {
      kind: 'group';
      groupId: string;
      depth: number;
      // 직속 + 후손 파트 모두 — 그룹 행 클릭 시 일괄 선택, 가시/잠금 상태 다수결에 사용.
      descendantParts: Part[];
      children: LayerNode[];
    };

// 드래그 중 표시할 드롭존. 라인 인디케이터(before/after) 또는 그룹 강조(into).
type DropTarget =
  | { kind: 'before' | 'after'; refKind: 'part' | 'group'; refId: string }
  | { kind: 'into'; groupId: string }
  | { kind: 'root-end' };

// HTML5 DnD 의 dataTransfer 는 dragOver 단계에서 실제 데이터를 못 읽기 때문에
// 모듈 단위 ref 로 현재 드래그 정보를 공유한다. 한 번에 하나의 드래그만 활성이라 안전.
let currentDragInfo:
  | { items: { kind: 'part' | 'group'; id: string }[] }
  | null = null;

function LayersTab() {
  const parts = useEditorStore((s) => s.sketch?.parts);
  const groupNames = useEditorStore((s) => s.sketch?.group_names);
  const groupParents = useEditorStore((s) => s.sketch?.group_parents);
  const selectedPartIds = useEditorStore((s) => s.selectedPartIds);
  const selectPart = useEditorStore((s) => s.selectPart);
  const selectMany = useEditorStore((s) => s.selectMany);
  const toggleVisibility = useEditorStore((s) => s.toggleVisibility);
  const toggleLock = useEditorStore((s) => s.toggleLock);
  const renamePart = useEditorStore((s) => s.renamePart);
  const renameGroup = useEditorStore((s) => s.renameGroup);
  const moveLayers = useEditorStore((s) => s.moveLayers);
  const getGroupDescendantPartIds = useEditorStore((s) => s.getGroupDescendantPartIds);

  // Vector 번호는 생성 순(parts 원본 배열 인덱스+1) 고정 — 정렬/재배치와 무관해야 사용자가 헷갈리지 않는다.
  const vectorNumberMap = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (!parts) return map;
    parts.forEach((p, i) => map.set(p.id, i + 1));
    return map;
  }, [parts]);

  const selectedSet = useMemo(() => new Set(selectedPartIds), [selectedPartIds]);

  // 그룹 트리 빌드 — 같은 부모를 가진 형제(파트 + 서브 그룹)를 z 내림차순으로 정렬해 재귀 노드 생성.
  const tree = useMemo<LayerNode[]>(() => {
    if (!parts || parts.length === 0) return [];
    const parents = groupParents ?? {};
    const allGroupIds = new Set<string>();
    for (const p of parts) if (p.group_id) allGroupIds.add(p.group_id);
    for (const [child, par] of Object.entries(parents)) {
      allGroupIds.add(child);
      if (par) allGroupIds.add(par);
    }

    // 그룹 → 모든 후손 파트 캐시.
    const descCache = new Map<string, Part[]>();
    const computeDesc = (g: string, seen: Set<string>): Part[] => {
      if (seen.has(g)) return [];
      seen.add(g);
      const cached = descCache.get(g);
      if (cached) return cached;
      const out: Part[] = [];
      for (const p of parts) if (p.group_id === g) out.push(p);
      for (const [child, par] of Object.entries(parents)) {
        if (par === g) out.push(...computeDesc(child, seen));
      }
      descCache.set(g, out);
      return out;
    };

    const groupMaxZ = (g: string): number => {
      const desc = computeDesc(g, new Set());
      let m = -Infinity;
      for (const p of desc) if (p.z_index > m) m = p.z_index;
      return m;
    };

    const buildChildren = (parent: string | undefined, depth: number): LayerNode[] => {
      const partsHere = parts.filter((p) => p.group_id === parent);
      const groupsHere = [...allGroupIds].filter((g) => parents[g] === parent);
      const items: { node: LayerNode; z: number }[] = [];
      for (const p of partsHere) {
        items.push({ node: { kind: 'part', part: p, depth }, z: p.z_index });
      }
      for (const gid of groupsHere) {
        items.push({
          node: {
            kind: 'group',
            groupId: gid,
            depth,
            descendantParts: computeDesc(gid, new Set()),
            children: buildChildren(gid, depth + 1),
          },
          z: groupMaxZ(gid),
        });
      }
      items.sort((a, b) => b.z - a.z);
      return items.map((i) => i.node);
    };

    return buildChildren(undefined, 0);
  }, [parts, groupParents]);

  // 트리 안의 모든 그룹 id 수집 — collapsed 정리용.
  const allGroupIdsInTree = useMemo<Set<string>>(() => {
    const out = new Set<string>();
    const walk = (nodes: LayerNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'group') {
          out.add(n.groupId);
          walk(n.children);
        }
      }
    };
    walk(tree);
    return out;
  }, [tree]);

  // 접힘 상태 — 프로젝트 진입(최초 트리 로드) 시 모든 그룹을 접힘으로 시작. 사라진 그룹 id 는 정리.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const collapsedInitializedRef = useRef(false);
  useEffect(() => {
    if (!collapsedInitializedRef.current && allGroupIdsInTree.size > 0) {
      collapsedInitializedRef.current = true;
      setCollapsed(new Set(allGroupIdsInTree));
      return;
    }
    if (collapsed.size === 0) return;
    let changed = false;
    const next = new Set(collapsed);
    for (const gid of collapsed) {
      if (!allGroupIdsInTree.has(gid)) {
        next.delete(gid);
        changed = true;
      }
    }
    if (changed) setCollapsed(next);
  }, [allGroupIdsInTree, collapsed]);

  // ── 범위 선택을 위한 평면 행 리스트 + anchor ─────────────────
  // 보이는 순서로 row 를 나열 (접힌 그룹의 자식은 제외). shift+클릭 시 두 행 사이의 모든 partId 를 선택.
  const flatRows = useMemo<{ key: string; partIds: string[] }[]>(() => {
    const rows: { key: string; partIds: string[] }[] = [];
    const walk = (nodes: LayerNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'part') {
          rows.push({ key: `part:${n.part.id}`, partIds: [n.part.id] });
        } else {
          rows.push({
            key: `group:${n.groupId}`,
            partIds: n.descendantParts.map((p) => p.id),
          });
          if (!collapsed.has(n.groupId)) walk(n.children);
        }
      }
    };
    walk(tree);
    return rows;
  }, [tree, collapsed]);

  const lastClickedKeyRef = useRef<string | null>(null);

  const handleRowSelect = useCallback(
    (key: string, partIds: string[], mods: { shift: boolean; mod: boolean }) => {
      if (mods.shift && lastClickedKeyRef.current) {
        const a = flatRows.findIndex((r) => r.key === lastClickedKeyRef.current);
        const b = flatRows.findIndex((r) => r.key === key);
        if (a >= 0 && b >= 0) {
          const [s, e] = a <= b ? [a, b] : [b, a];
          const ids = new Set<string>();
          for (let i = s; i <= e; i++) {
            flatRows[i].partIds.forEach((id) => ids.add(id));
          }
          selectMany([...ids]);
          return;
        }
      }
      if (mods.mod && partIds.length === 1) {
        selectPart(partIds[0], true);
      } else if (partIds.length === 1) {
        selectPart(partIds[0], false);
      } else {
        selectMany(partIds);
      }
      lastClickedKeyRef.current = key;
    },
    [flatRows, selectMany, selectPart],
  );

  // ── DnD ─────────────────────────────────────────────────────
  // dragHover 는 현재 호버 중인 드롭존 — 라인/링 인디케이터 렌더에 사용.
  const [dragHover, setDragHover] = useState<DropTarget | null>(null);

  // 드래그 시작 — 클릭한 행의 항목을 기본으로 잡되, 다중 선택 안에 있으면 선택 항목들을 함께 끌어간다.
  const computeDragItems = useCallback(
    (origin: { kind: 'part' | 'group'; id: string }): { kind: 'part' | 'group'; id: string }[] => {
      if (origin.kind === 'part' && selectedSet.has(origin.id) && selectedPartIds.length > 1) {
        // 선택된 파트가 다수일 때, 모두 끌어간다. 그 중 같은 그룹의 모든 파트가 들어 있으면 그룹 단위로 묶어 끌어간다.
        const idSet = new Set(selectedPartIds);
        // 모든 그룹에서 후손이 다 idSet 에 있으면 → 그룹 단위로 (중복 회피).
        const allGroupIds = new Set<string>();
        if (parts) for (const p of parts) if (p.group_id) allGroupIds.add(p.group_id);
        if (groupParents) for (const [child, par] of Object.entries(groupParents)) {
          allGroupIds.add(child);
          if (par) allGroupIds.add(par);
        }
        const fullySelected = new Set<string>();
        for (const g of allGroupIds) {
          const desc = getGroupDescendantPartIds(g);
          if (desc.length === 0) continue;
          if (desc.every((id) => idSet.has(id))) fullySelected.add(g);
        }
        // maximal — 부모가 fullySelected 가 아닌 것만.
        const maximal = new Set<string>();
        for (const g of fullySelected) {
          const par = groupParents?.[g];
          if (!par || !fullySelected.has(par)) maximal.add(g);
        }
        const out: { kind: 'part' | 'group'; id: string }[] = [];
        const wrappedPartIds = new Set<string>();
        for (const g of maximal) {
          out.push({ kind: 'group', id: g });
          for (const id of getGroupDescendantPartIds(g)) wrappedPartIds.add(id);
        }
        for (const id of selectedPartIds) {
          if (!wrappedPartIds.has(id)) out.push({ kind: 'part', id });
        }
        return out;
      }
      return [origin];
    },
    [selectedSet, selectedPartIds, parts, groupParents, getGroupDescendantPartIds],
  );

  const onDragStart = useCallback(
    (e: React.DragEvent, origin: { kind: 'part' | 'group'; id: string }) => {
      const items = computeDragItems(origin);
      currentDragInfo = { items };
      e.dataTransfer.effectAllowed = 'move';
      // 데이터를 실제로 쓰진 않지만, 일부 브라우저는 setData 가 없으면 드래그를 시작하지 않는다.
      try {
        e.dataTransfer.setData('application/x-sketchpack-layer', '1');
      } catch {
        /* 무시 */
      }
    },
    [computeDragItems],
  );

  const onDragEnd = useCallback(() => {
    currentDragInfo = null;
    setDragHover(null);
  }, []);

  // 드래그된 항목이 자기 후손 안으로 들어가는 무효 케이스 + 자기 위에 떨어지는 케이스를 미리 차단.
  const isInvalidTarget = useCallback(
    (target: DropTarget): boolean => {
      const info = currentDragInfo;
      if (!info) return false;
      // 자기 자신을 anchor 로 한 before/after 는 의미 없음.
      if (target.kind === 'before' || target.kind === 'after') {
        for (const it of info.items) {
          if (it.kind === target.refKind && it.id === target.refId) return true;
        }
      }
      // 새 부모를 결정해 — 그 조상 체인에 드래그 중인 그룹이 끼어 있으면 사이클이 되어 무효.
      // root-end 는 부모가 루트라 사이클 불가.
      let newParent: string | undefined;
      if (target.kind === 'into') newParent = target.groupId;
      else if (target.kind === 'before' || target.kind === 'after') {
        if (target.refKind === 'part') {
          newParent = parts?.find((p) => p.id === target.refId)?.group_id;
        } else {
          newParent = groupParents?.[target.refId];
        }
      }
      if (newParent && groupParents) {
        const ancestors = new Set<string>();
        let cur: string | undefined = newParent;
        const seen = new Set<string>();
        while (cur && !seen.has(cur)) {
          ancestors.add(cur);
          seen.add(cur);
          cur = groupParents[cur];
        }
        for (const it of info.items) {
          if (it.kind === 'group' && ancestors.has(it.id)) return true;
        }
      }
      return false;
    },
    [groupParents, parts],
  );

  const onDropTarget = useCallback(
    (target: DropTarget) => {
      const info = currentDragInfo;
      currentDragInfo = null;
      setDragHover(null);
      if (!info || info.items.length === 0) return;
      if (isInvalidTarget(target)) return;
      if (target.kind === 'into') {
        moveLayers(info.items, { kind: 'into-group', groupId: target.groupId });
      } else if (target.kind === 'root-end') {
        moveLayers(info.items, { kind: 'root-end' });
      } else {
        moveLayers(info.items, {
          kind: target.kind,
          refKind: target.refKind,
          refId: target.refId,
        });
      }
    },
    [moveLayers, isInvalidTarget],
  );

  const isPartCount = parts ? parts.length : 0;

  return (
    <div className="py-1">
      {isPartCount === 0 ? (
        <EmptyState />
      ) : (
        <ul role="tree" aria-label="레이어 목록">
          {tree.map((node) => (
            <NodeView
              key={node.kind === 'part' ? `p:${node.part.id}` : `g:${node.groupId}`}
              node={node}
              ctx={{
                vectorNumberMap,
                groupNames,
                selectedSet,
                collapsed,
                setCollapsed,
                handleRowSelect,
                toggleVisibility,
                toggleLock,
                renamePart,
                renameGroup,
                onDragStart,
                onDragEnd,
                onDropTarget,
                isInvalidTarget,
                dragHover,
                setDragHover,
              }}
            />
          ))}
          {/* 모든 행 아래의 빈 영역 — 루트 끝으로 떨어뜨리기. */}
          <RootDropZone
            dragHover={dragHover}
            setDragHover={setDragHover}
            onDropTarget={onDropTarget}
            isInvalidTarget={isInvalidTarget}
          />
        </ul>
      )}
    </div>
  );
}

// 자식 컴포넌트들이 공유해 쓰는 컨텍스트 묶음 — 노드 트리 깊이가 가변이라 prop drilling 대신 한 객체로.
interface NodeCtx {
  vectorNumberMap: Map<string, number>;
  groupNames: Record<string, string> | undefined;
  selectedSet: Set<string>;
  collapsed: Set<string>;
  setCollapsed: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleRowSelect: (key: string, partIds: string[], mods: { shift: boolean; mod: boolean }) => void;
  toggleVisibility: (ids: string[]) => void;
  toggleLock: (ids: string[]) => void;
  renamePart: (id: string, name: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  onDragStart: (e: React.DragEvent, origin: { kind: 'part' | 'group'; id: string }) => void;
  onDragEnd: () => void;
  onDropTarget: (target: DropTarget) => void;
  isInvalidTarget: (target: DropTarget) => boolean;
  dragHover: DropTarget | null;
  setDragHover: React.Dispatch<React.SetStateAction<DropTarget | null>>;
}

// 트리 노드 한 개를 렌더 — part 면 PartRow, group 이면 GroupRow + 재귀.
function NodeView({ node, ctx }: { node: LayerNode; ctx: NodeCtx }) {
  if (node.kind === 'part') {
    const partKey = `part:${node.part.id}`;
    return (
      <PartRow
        part={node.part}
        depth={node.depth}
        vectorNumber={ctx.vectorNumberMap.get(node.part.id) ?? 0}
        isSelected={ctx.selectedSet.has(node.part.id)}
        onSelect={(mods) => ctx.handleRowSelect(partKey, [node.part.id], mods)}
        onToggleVisibility={() => ctx.toggleVisibility([node.part.id])}
        onToggleLock={() => ctx.toggleLock([node.part.id])}
        onRename={(name) => ctx.renamePart(node.part.id, name)}
        ctx={ctx}
      />
    );
  }
  const memberIds = node.descendantParts.map((p) => p.id);
  const allSelected = memberIds.length > 0 && memberIds.every((id) => ctx.selectedSet.has(id));
  const someSelected = !allSelected && memberIds.some((id) => ctx.selectedSet.has(id));
  const expanded = !ctx.collapsed.has(node.groupId);
  const groupKey = `group:${node.groupId}`;
  return (
    <GroupRow
      groupId={node.groupId}
      depth={node.depth}
      groupName={ctx.groupNames?.[node.groupId]}
      childCount={node.children.length}
      descendantPartCount={node.descendantParts.length}
      anyHidden={node.descendantParts.some((m) => m.visible === false)}
      anyLocked={node.descendantParts.some((m) => m.locked === true)}
      expanded={expanded}
      groupSelected={allSelected}
      groupHasSelection={someSelected}
      onToggleExpand={() =>
        ctx.setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(node.groupId)) next.delete(node.groupId);
          else next.add(node.groupId);
          return next;
        })
      }
      onSelectGroup={(mods) => ctx.handleRowSelect(groupKey, memberIds, mods)}
      onToggleGroupVisibility={() => ctx.toggleVisibility(memberIds)}
      onToggleGroupLock={() => ctx.toggleLock(memberIds)}
      onRenameGroup={(name) => ctx.renameGroup(node.groupId, name)}
      ctx={ctx}
    >
      {expanded
        ? node.children.map((child) => (
            <NodeView
              key={child.kind === 'part' ? `p:${child.part.id}` : `g:${child.groupId}`}
              node={child}
              ctx={ctx}
            />
          ))
        : null}
    </GroupRow>
  );
}

// 모든 행 아래의 잔여 영역 — 여기로 드롭하면 루트 레벨 가장 끝(맨 아래)으로.
function RootDropZone({
  dragHover,
  setDragHover,
  onDropTarget,
  isInvalidTarget,
}: {
  dragHover: DropTarget | null;
  setDragHover: React.Dispatch<React.SetStateAction<DropTarget | null>>;
  onDropTarget: (target: DropTarget) => void;
  isInvalidTarget: (target: DropTarget) => boolean;
}) {
  const active =
    dragHover?.kind === 'root-end' ? true : false;
  return (
    <li
      role="presentation"
      onDragOver={(e) => {
        const target: DropTarget = { kind: 'root-end' };
        if (isInvalidTarget(target)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (
          !dragHover ||
          dragHover.kind !== 'root-end'
        ) {
          setDragHover(target);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropTarget({ kind: 'root-end' });
      }}
      // 빈 영역이라 시각적 단서가 없으므로 hover 시 1px 라인을 보여 준다.
      style={{ height: 16, position: 'relative' }}
    >
      {active ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 12,
            right: 8,
            top: 4,
            height: 2,
            backgroundColor: '#3884ff',
            borderRadius: 1,
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </li>
  );
}

function LibraryTab() {
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const libraryAssets = useEditorStore((s) => s.libraryAssets);
  const removeLibraryAsset = useEditorStore((s) => s.removeLibraryAsset);
  const applyLibraryAssetToCanvas = useEditorStore((s) => s.applyLibraryAssetToCanvas);

  // 검색어로 추가된 에셋을 필터링 — 이름 / 카테고리 모두 매칭.
  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return libraryAssets;
    return libraryAssets.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q),
    );
  }, [libraryAssets, query]);

  // 카테고리별로 그룹화 — figma 라이브러리 패널처럼 카테고리 헤더 + 카드 그리드.
  const grouped = useMemo(() => {
    const map = new Map<string, LibraryAsset[]>();
    for (const a of filteredAssets) {
      const list = map.get(a.category);
      if (list) list.push(a);
      else map.set(a.category, [a]);
    }
    return [...map.entries()];
  }, [filteredAssets]);

  const hasAssets = libraryAssets.length > 0;

  return (
    <>
    {modalOpen ? <LibraryModal onClose={() => setModalOpen(false)} /> : null}
    <div className="py-2">
      {/* 검색 + 필터 — 라이브러리 데이터가 비어 있는 동안에도 UI 실루엣 유지. */}
      <div className="px-3 pb-2 flex items-center gap-1">
        <div
          className="flex-1 h-7 flex items-center gap-1.5 px-2 rounded border bg-white"
          style={{ borderColor: 'hsl(var(--editor-border))' }}
        >
          <Search
            size={12}
            strokeWidth={1.75}
            className="shrink-0 text-[hsl(var(--editor-mute))]"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="모든 라이브러리 검색"
            className="flex-1 min-w-0 bg-transparent outline-none text-[12px] placeholder:text-[hsl(var(--editor-mute))]"
            style={{ letterSpacing: '-0.14px' }}
            aria-label="라이브러리 검색"
          />
        </div>
        <button
          type="button"
          aria-label="필터"
          title="필터"
          className="w-7 h-7 shrink-0 flex items-center justify-center rounded text-[hsl(var(--editor-mute))] hover:text-foreground hover:bg-black/[0.06] transition-colors"
        >
          <SlidersHorizontal size={14} strokeWidth={1.75} />
        </button>
      </div>

      {hasAssets ? (
        // 에셋이 추가된 상태 — 카테고리별 카드 그리드. 상단에 "에셋 추가" 버튼 유지.
        <>
          <div className="px-3 pt-1 pb-2">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
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
              에셋 추가
            </button>
          </div>

          {grouped.length === 0 ? (
            <p
              className="text-[11px] text-[hsl(var(--editor-mute))] text-center mt-4 px-3"
              style={{ letterSpacing: '-0.14px' }}
            >
              검색 결과가 없습니다
            </p>
          ) : (
            <div className="px-3 flex flex-col gap-3">
              {grouped.map(([category, assets]) => (
                <section key={category}>
                  <h3
                    className="text-[10px] font-medium text-[hsl(var(--editor-mute))] uppercase mb-1.5 px-0.5"
                    style={{ letterSpacing: '0.04em' }}
                  >
                    {category}
                  </h3>
                  <ul className="grid grid-cols-2 gap-1.5">
                    {assets.map((asset) => (
                      <LibraryAssetCard
                        key={asset.id}
                        asset={asset}
                        onRemove={() => removeLibraryAsset(asset.id)}
                        onApply={() => {
                          void applyLibraryAssetToCanvas(asset.id);
                        }}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      ) : (
        // 빈 상태 — 기존 안내 카드 + 사전 제작 에셋 CTA.
        <>
          {/* 빈 상태 카드 — 팀 라이브러리가 없는 figma 패널의 안내 카드 형태. */}
          <div className="px-3 pt-1">
            <div
              className="rounded-md p-3 flex flex-col gap-2.5"
              style={{ backgroundColor: 'hsl(var(--editor-bg))' }}
            >
              <div
                className="w-7 h-7 rounded flex items-center justify-center text-white"
                style={{ backgroundColor: 'hsl(var(--editor-active))' }}
                aria-hidden
              >
                <BookOpen size={14} strokeWidth={1.75} />
              </div>
              <div className="flex flex-col gap-1">
                <p
                  className="text-[12px] font-semibold text-foreground"
                  style={{ letterSpacing: '-0.14px' }}
                >
                  아직 라이브러리가 없습니다.
                </p>
                <p
                  className="text-[11px] text-[hsl(var(--editor-mute))] leading-relaxed"
                  style={{ letterSpacing: '-0.14px' }}
                >
                  에셋을 찾아 이 파일에 추가하여 사용하세요.{' '}
                  <a
                    href="#"
                    onClick={(e) => e.preventDefault()}
                    className="text-foreground underline underline-offset-2 hover:no-underline"
                  >
                    자세히 알아보기
                  </a>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="h-7 self-start px-3 rounded text-[12px] font-medium text-white transition-colors hover:brightness-110"
                style={{ backgroundColor: '#3884ff', letterSpacing: '-0.14px' }}
              >
                라이브러리 탐색하기
              </button>
            </div>
          </div>

          <p
            className="text-[11px] text-[hsl(var(--editor-mute))] text-center mt-4 mb-2 px-3"
            style={{ letterSpacing: '-0.14px' }}
          >
            또는 사전 제작된 에셋으로 시작하세요
          </p>

          <div className="px-3">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className={[
                'w-full h-9 flex items-center justify-center gap-1.5 rounded border bg-white',
                'text-[12px] font-medium text-foreground',
                'hover:bg-[hsl(var(--editor-hover))] transition-colors',
              ].join(' ')}
              style={{
                borderColor: 'hsl(var(--editor-border))',
                letterSpacing: '-0.14px',
              }}
            >
              <Plus size={13} strokeWidth={1.75} />
              에셋 추가
            </button>
          </div>
        </>
      )}
    </div>
    </>
  );
}

// 좌측 라이브러리 탭의 에셋 카드 — 정사각형 SVG 미리보기 + 이름 + hover 시 제거 버튼.
// 카드 본체 클릭 → 캔버스의 카테고리 동명 그룹을 숨기고 이 에셋으로 교체.
function LibraryAssetCard({
  asset,
  onRemove,
  onApply,
}: {
  asset: LibraryAsset;
  onRemove: () => void;
  onApply: () => void;
}) {
  return (
    <li>
      <div
        className="group/asset relative w-full flex flex-col gap-1 p-1.5 rounded border bg-white hover:bg-[hsl(var(--editor-hover))] transition-colors"
        style={{ borderColor: 'hsl(var(--editor-border))' }}
      >
        <button
          type="button"
          onClick={onApply}
          aria-label={`${asset.name} 캔버스에 적용`}
          title={`${asset.name} 적용`}
          className="aspect-square w-full rounded border bg-white overflow-hidden flex items-center justify-center"
          style={{ borderColor: 'hsl(var(--editor-border))' }}
        >
          <img
            src={asset.svgUrl}
            alt={asset.name}
            className="w-full h-full object-contain pointer-events-none"
            draggable={false}
          />
        </button>
        <p
          className="text-[11px] font-medium text-foreground truncate px-0.5"
          style={{ letterSpacing: '-0.14px' }}
          title={asset.name}
        >
          {asset.name}
        </p>
        <button
          type="button"
          aria-label={`${asset.name} 제거`}
          title="제거"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={[
            'absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded',
            'bg-white/95 border text-[hsl(var(--editor-mute))]',
            'opacity-0 group-hover/asset:opacity-100 hover:text-foreground transition-opacity',
          ].join(' ')}
          style={{ borderColor: 'hsl(var(--editor-border))' }}
        >
          <X size={10} strokeWidth={2} />
        </button>
      </div>
    </li>
  );
}

// 에셋 라이브러리 관리 모달 — figma_library_refer.png 의 좌측 메뉴 + 우측 콘텐츠 구조.
// "추천" 아래의 "기본" 메뉴는 SketchFlat 이 기본 제공하는 부품 템플릿 카탈로그.
type LibrarySection = 'this-file' | 'updates' | 'recommended' | 'team' | 'default';

function LibraryModal({ onClose }: { onClose: () => void }) {
  // 모달이 열렸을 때 가장 의미있는 콘텐츠가 있는 "기본" 섹션을 기본 선택.
  const [section, setSection] = useState<LibrarySection>('default');
  const [query, setQuery] = useState('');
  // "기본" 아래 카테고리 서브메뉴 — null 이면 전체, 카테고리명이면 해당 카테고리만 표시.
  const [defaultCategory, setDefaultCategory] = useState<string | null>(null);
  // "기본" 메뉴 펼침 상태 — default 섹션이 활성인 동안에는 기본 펼침.
  const [defaultExpanded, setDefaultExpanded] = useState(true);

  // 모달 안에서만 유지되는 다중 선택 상태 — "추가" 버튼을 누르기 전까지는 store 에 반영하지 않는다.
  const addLibraryAssets = useEditorStore((s) => s.addLibraryAssets);
  const existingAssetIds = useEditorStore((s) => s.libraryAssets);
  const alreadyAdded = useMemo(
    () => new Set(existingAssetIds.map((a) => a.id)),
    [existingAssetIds],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Supabase 의 library_assets 테이블 + 공개 버킷에서 카탈로그를 1회 fetch.
  // 카테고리별로 묶어서 카드 그리드 렌더에 그대로 사용.
  const [catalog, setCatalog] = useState<LibraryCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetchLibraryCatalog().then((rows) => {
      if (cancelled) return;
      setCatalog(rows);
      setCatalogLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogByCategory = useMemo(() => {
    const map = new Map<string, LibraryCatalogEntry[]>();
    for (const e of catalog) {
      const list = map.get(e.category);
      if (list) list.push(e);
      else map.set(e.category, [e]);
    }
    return [...map.entries()].map(([category, entries]) => ({ category, entries }));
  }, [catalog]);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function commitAdd() {
    const list: LibraryAsset[] = [];
    for (const e of catalog) {
      if (selected.has(e.id)) {
        list.push({ id: e.id, name: e.name, category: e.category, svgUrl: e.svgUrl });
      }
    }
    if (list.length > 0) addLibraryAssets(list);
    onClose();
  }

  // Esc 로 닫기. 백드롭 클릭으로도 닫힘.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="라이브러리 관리"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="relative w-[860px] max-w-[92vw] h-[600px] max-h-[84vh] rounded-lg bg-white shadow-xl flex flex-col overflow-hidden"
        style={{ border: '1px solid hsl(var(--editor-border))' }}
      >
        {/* 헤더 */}
        <div
          className="h-11 px-4 flex items-center justify-between border-b shrink-0"
          style={{ borderColor: 'hsl(var(--editor-border))' }}
        >
          <h2
            className="text-[13px] font-semibold text-foreground"
            style={{ letterSpacing: '-0.2px' }}
          >
            라이브러리 관리
          </h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded text-[hsl(var(--editor-mute))] hover:text-foreground hover:bg-black/[0.06] transition-colors"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* 좌측 사이드바 */}
          <aside
            className="w-[220px] shrink-0 border-r flex flex-col p-3 gap-3 overflow-y-auto"
            style={{ borderColor: 'hsl(var(--editor-border))' }}
          >
            <div
              className="h-8 flex items-center gap-1.5 px-2 rounded border"
              style={{ borderColor: 'hsl(var(--editor-border))' }}
            >
              <Search
                size={12}
                strokeWidth={1.75}
                className="shrink-0 text-[hsl(var(--editor-mute))]"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="모든 라이브러리 검색"
                className="flex-1 min-w-0 bg-transparent outline-none text-[12px] placeholder:text-[hsl(var(--editor-mute))]"
                style={{ letterSpacing: '-0.14px' }}
                aria-label="라이브러리 검색"
              />
            </div>

            <nav className="flex flex-col gap-0.5">
              <ModalNavItem
                icon={<BookOpen size={14} strokeWidth={1.75} />}
                label="이 파일"
                active={section === 'this-file'}
                onClick={() => setSection('this-file')}
              />
              <ModalNavItem
                icon={<RefreshCw size={14} strokeWidth={1.75} />}
                label="업데이트"
                active={section === 'updates'}
                onClick={() => setSection('updates')}
              />
            </nav>

            <div>
              <p
                className="px-2 mb-1 text-[10px] font-medium text-[hsl(var(--editor-mute))]"
                style={{ letterSpacing: '-0.1px' }}
              >
                라이브러리 탐색
              </p>
              <nav className="flex flex-col gap-0.5">
                <ModalNavItem
                  icon={<Lightbulb size={14} strokeWidth={1.75} />}
                  label="추천"
                  active={section === 'recommended'}
                  onClick={() => setSection('recommended')}
                />
                <ModalNavItem
                  icon={<Users size={14} strokeWidth={1.75} />}
                  label="팀"
                  active={section === 'team'}
                  onClick={() => setSection('team')}
                />
                <ModalNavItem
                  icon={<Package size={14} strokeWidth={1.75} />}
                  label="기본"
                  // 카테고리가 선택되지 않은 "전체 보기" 상태에서만 강조.
                  active={section === 'default' && defaultCategory === null}
                  onClick={() => {
                    setSection('default');
                    setDefaultCategory(null);
                    setDefaultExpanded(true);
                  }}
                  expandable
                  expanded={section === 'default' && defaultExpanded}
                  onToggleExpand={() => {
                    setSection('default');
                    setDefaultExpanded((v) => !v);
                  }}
                />
                {section === 'default' && defaultExpanded ? (
                  <div className="flex flex-col gap-0.5 pl-5">
                    {catalogByCategory.map((cat) => (
                      <ModalSubNavItem
                        key={cat.category}
                        label={cat.category}
                        active={defaultCategory === cat.category}
                        onClick={() => {
                          setSection('default');
                          setDefaultCategory(cat.category);
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </nav>
            </div>
          </aside>

          {/* 우측 콘텐츠 */}
          <section className="flex-1 min-w-0 overflow-y-auto">
            {section === 'default' ? (
              <DefaultTemplatesView
                selectedCategory={defaultCategory}
                selected={selected}
                alreadyAdded={alreadyAdded}
                onToggle={toggleSelected}
                categories={catalogByCategory}
                loading={catalogLoading}
              />
            ) : (
              <ModalEmptyState section={section} />
            )}
          </section>
        </div>

        {/* 푸터 — 선택이 있을 때만 활성화. 카운트 + "추가" 버튼. */}
        <div
          className="h-12 px-4 flex items-center justify-between border-t shrink-0"
          style={{ borderColor: 'hsl(var(--editor-border))' }}
        >
          <p
            className="text-[12px] text-[hsl(var(--editor-mute))]"
            style={{ letterSpacing: '-0.14px' }}
          >
            {selected.size > 0
              ? `${selected.size}개 선택됨`
              : '에셋을 클릭해 선택하세요'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-7 px-3 rounded text-[12px] font-medium text-foreground hover:bg-black/[0.06] transition-colors"
              style={{ letterSpacing: '-0.14px' }}
            >
              취소
            </button>
            <button
              type="button"
              onClick={commitAdd}
              disabled={selected.size === 0}
              className={[
                'h-7 px-3 rounded text-[12px] font-medium text-white transition-colors',
                selected.size === 0
                  ? 'bg-[#3884ff]/40 cursor-not-allowed'
                  : 'bg-[#3884ff] hover:brightness-110',
              ].join(' ')}
              style={{ letterSpacing: '-0.14px' }}
            >
              {selected.size > 0 ? `${selected.size}개 추가` : '추가'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalNavItem({
  icon,
  label,
  active,
  onClick,
  expandable,
  expanded,
  onToggleExpand,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  // 서브메뉴를 가지는 항목은 우측에 chevron 토글을 노출.
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  return (
    <div
      className={[
        'h-8 pr-1 flex items-center rounded transition-colors',
        active
          ? 'bg-black/[0.06] text-foreground'
          : 'text-foreground/85 hover:bg-black/[0.04]',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex-1 min-w-0 h-8 pl-2 flex items-center gap-2 text-[12px] text-left"
        style={{
          letterSpacing: '-0.14px',
          fontWeight: active ? 500 : 400,
        }}
      >
        <span
          className={
            active ? 'text-foreground' : 'text-[hsl(var(--editor-mute))]'
          }
        >
          {icon}
        </span>
        <span className="flex-1 truncate">{label}</span>
      </button>
      {expandable ? (
        <button
          type="button"
          aria-label={expanded ? '카테고리 접기' : '카테고리 펼치기'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand?.();
          }}
          className="w-6 h-6 flex items-center justify-center rounded text-[hsl(var(--editor-mute))] hover:text-foreground hover:bg-black/[0.06] transition-colors"
        >
          {expanded ? (
            <ChevronDown size={12} strokeWidth={1.75} />
          ) : (
            <ChevronRight size={12} strokeWidth={1.75} />
          )}
        </button>
      ) : null}
    </div>
  );
}

function ModalSubNavItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'h-7 px-2 flex items-center rounded text-[12px] text-left transition-colors',
        active
          ? 'bg-black/[0.06] text-foreground font-medium'
          : 'text-foreground/75 hover:bg-black/[0.04]',
      ].join(' ')}
      style={{ letterSpacing: '-0.14px' }}
    >
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

function DefaultTemplatesView({
  selectedCategory,
  selected,
  alreadyAdded,
  onToggle,
  categories,
  loading,
}: {
  selectedCategory: string | null;
  selected: Set<string>;
  alreadyAdded: Set<string>;
  onToggle: (id: string) => void;
  categories: { category: string; entries: LibraryCatalogEntry[] }[];
  loading: boolean;
}) {
  // 카테고리가 선택되어 있으면 해당 카테고리만, 아니면 전체 카테고리를 표시.
  const visible =
    selectedCategory === null
      ? categories
      : categories.filter((c) => c.category === selectedCategory);

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-8 text-center gap-2">
        <p
          className="text-[12px] text-[hsl(var(--editor-mute))]"
          style={{ letterSpacing: '-0.14px' }}
        >
          라이브러리 불러오는 중…
        </p>
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-8 text-center gap-2">
        <p
          className="text-[13px] font-semibold text-foreground"
          style={{ letterSpacing: '-0.2px' }}
        >
          카테고리를 찾을 수 없습니다
        </p>
        <p
          className="text-[12px] text-[hsl(var(--editor-mute))] leading-relaxed"
          style={{ letterSpacing: '-0.14px' }}
        >
          좌측 메뉴에서 다른 카테고리를 선택해 주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="p-5 flex flex-col gap-6">
      {visible.map((cat) => (
        <section key={cat.category}>
          <h3
            className="text-[13px] font-semibold text-foreground mb-2"
            style={{ letterSpacing: '-0.2px' }}
          >
            {cat.category}
          </h3>
          <ul className="grid grid-cols-3 gap-2">
            {cat.entries.map((t) => {
              const isSelected = selected.has(t.id);
              const isAdded = alreadyAdded.has(t.id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(t.id)}
                    aria-pressed={isSelected}
                    className={[
                      'relative w-full flex flex-col gap-1.5 p-2 rounded border bg-white transition-colors text-left',
                      isSelected
                        ? 'border-[#3884ff] ring-1 ring-[#3884ff]'
                        : 'hover:bg-[hsl(var(--editor-hover))]',
                    ].join(' ')}
                    style={
                      isSelected
                        ? undefined
                        : { borderColor: 'hsl(var(--editor-border))' }
                    }
                  >
                    <div
                      className="aspect-square w-full rounded border bg-white overflow-hidden flex items-center justify-center"
                      style={{ borderColor: 'hsl(var(--editor-border))' }}
                    >
                      <img
                        src={t.svgUrl}
                        alt={t.name}
                        className="w-full h-full object-contain pointer-events-none"
                        draggable={false}
                      />
                    </div>
                    <p
                      className="text-[12px] font-medium text-foreground truncate"
                      style={{ letterSpacing: '-0.14px' }}
                    >
                      {t.name}
                    </p>

                    {/* 선택 표시 — 우상단의 체크 배지. 이미 추가된 항목은 파란 점으로 표시. */}
                    {isSelected ? (
                      <span
                        className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-white shadow-sm"
                        style={{ backgroundColor: '#3884ff' }}
                        aria-hidden
                      >
                        <Check size={10} strokeWidth={2.5} />
                      </span>
                    ) : isAdded ? (
                      <span
                        className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-white border flex items-center justify-center"
                        style={{ borderColor: '#3884ff' }}
                        title="이미 추가됨"
                        aria-label="이미 추가됨"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: '#3884ff' }}
                        />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ModalEmptyState({ section }: { section: LibrarySection }) {
  const copy = (() => {
    switch (section) {
      case 'this-file':
        return {
          title: '이 파일에 추가된 라이브러리 없음',
          desc: '아직 이 파일에 연결된 라이브러리가 없습니다. 좌측 메뉴에서 라이브러리를 탐색해 추가하세요.',
        };
      case 'updates':
        return {
          title: '업데이트 없음',
          desc: '최신 상태입니다.',
        };
      case 'recommended':
        return {
          title: '추천 라이브러리 준비 중',
          desc: '곧 사용자에게 맞는 라이브러리를 추천해드릴 예정입니다.',
        };
      case 'team':
        return {
          title: '팀 라이브러리 없음',
          desc: '팀에 공유된 라이브러리가 없습니다. 팀을 만들면 라이브러리를 함께 사용할 수 있습니다.',
        };
      default:
        return { title: '', desc: '' };
    }
  })();
  return (
    <div className="h-full flex flex-col items-center justify-center px-8 text-center gap-2">
      <p
        className="text-[13px] font-semibold text-foreground"
        style={{ letterSpacing: '-0.2px' }}
      >
        {copy.title}
      </p>
      <p
        className="text-[12px] text-[hsl(var(--editor-mute))] leading-relaxed"
        style={{ letterSpacing: '-0.14px' }}
      >
        {copy.desc}
      </p>
    </div>
  );
}

function PartRow({
  part,
  depth,
  vectorNumber,
  isSelected,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onRename,
  ctx,
}: {
  part: Part;
  depth: number;
  vectorNumber: number;
  isSelected: boolean;
  onSelect: (mods: { shift: boolean; mod: boolean }) => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onRename: (name: string) => void;
  ctx: NodeCtx;
}) {
  const fallbackLabel = `Path ${vectorNumber}`;
  const label = part.name && part.name.length > 0 ? part.name : fallbackLabel;
  const isHidden = part.visible === false;
  const isLocked = part.locked === true;
  const [editing, setEditing] = useState(false);

  // 드래그된 항목의 출처(자기 자신)인지 — 드롭존 인디케이터를 자기 행 위/아래에 그릴지 결정.
  const hover = ctx.dragHover;
  const showBefore =
    hover && hover.kind === 'before' && hover.refKind === 'part' && hover.refId === part.id;
  const showAfter =
    hover && hover.kind === 'after' && hover.refKind === 'part' && hover.refId === part.id;

  // 드래그 오버 시 — 행을 위/아래 절반으로 나눠 before/after 결정.
  const onRowDragOver = (e: React.DragEvent) => {
    if (!currentDragInfo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const half = rect.top + rect.height / 2;
    const target: DropTarget = {
      kind: e.clientY < half ? 'before' : 'after',
      refKind: 'part',
      refId: part.id,
    };
    if (ctx.isInvalidTarget(target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (
      !hover ||
      hover.kind !== target.kind ||
      hover.refKind !== 'part' ||
      hover.refId !== part.id
    ) {
      ctx.setDragHover(target);
    }
  };

  return (
    <li role="treeitem" aria-selected={isSelected} style={{ position: 'relative' }}>
      <div
        draggable={!editing}
        onDragStart={(e) => ctx.onDragStart(e, { kind: 'part', id: part.id })}
        onDragEnd={ctx.onDragEnd}
        onDragOver={onRowDragOver}
        onDragLeave={() => {
          // 행 사이를 빠르게 옮길 때 깜빡임 방지: 다음 onDragOver 가 곧 새 hover 를 세팅한다.
        }}
        onDrop={(e) => {
          if (!currentDragInfo) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const half = rect.top + rect.height / 2;
          const target: DropTarget = {
            kind: e.clientY < half ? 'before' : 'after',
            refKind: 'part',
            refId: part.id,
          };
          if (ctx.isInvalidTarget(target)) return;
          e.preventDefault();
          e.stopPropagation();
          ctx.onDropTarget(target);
        }}
        className={[
          'group/row w-full flex items-center pr-2 h-7 transition-colors',
          isSelected
            ? 'bg-black/[0.06] text-foreground'
            : 'text-foreground/85 hover:bg-black/[0.04]',
        ].join(' ')}
        style={{
          fontSize: '12px',
          fontWeight: isSelected ? 500 : 400,
          letterSpacing: '-0.14px',
          paddingLeft: 12 + depth * 12,
        }}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            if (editing) return;
            onSelect({ shift: e.shiftKey, mod: e.metaKey || e.ctrlKey });
          }}
          onKeyDown={(e) => {
            if (editing) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect({ shift: e.shiftKey, mod: e.metaKey || e.ctrlKey });
            }
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEditing(true);
          }}
          className="flex-1 min-w-0 flex items-center gap-2 text-left h-7 cursor-default"
          title={part.id}
          style={{ opacity: isHidden ? 0.45 : 1 }}
        >
          <PathThumb part={part} />
          {editing ? (
            <InlineRenameLabel
              initial={label}
              onCommit={(value) => {
                if (value === fallbackLabel) onRename('');
                else onRename(value);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <span className="truncate flex-1">{label}</span>
          )}
        </div>
        <LayerActionIcons
          isHidden={isHidden}
          isLocked={isLocked}
          onToggleVisibility={onToggleVisibility}
          onToggleLock={onToggleLock}
        />
      </div>
      {showBefore ? <DropLine position="top" depth={depth} /> : null}
      {showAfter ? <DropLine position="bottom" depth={depth} /> : null}
    </li>
  );
}

// 드롭 위치 시각화 — 행 상단 또는 하단에 1px 라인을 절대 위치로 띄운다.
function DropLine({ position, depth }: { position: 'top' | 'bottom'; depth: number }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        left: 12 + depth * 12,
        right: 8,
        [position]: -1,
        height: 2,
        backgroundColor: '#3884ff',
        borderRadius: 1,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    />
  );
}

// 더블클릭으로 진입하는 인라인 텍스트 편집기. mount 시 포커스+전체 선택,
// Enter/blur=커밋, Escape=취소. 부모는 editing 토글만 책임지면 된다.
function InlineRenameLabel({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        // Esc/Enter 가 부모(트리 단축키 등)로 새지 않도록 차단.
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => onCommit(value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="flex-1 min-w-0 h-5 px-1 rounded bg-white border outline-none focus:border-[#3884ff]"
      style={{
        fontSize: '12px',
        letterSpacing: '-0.14px',
        borderColor: 'hsl(var(--editor-border))',
      }}
    />
  );
}

// 행 우측의 눈 / 자물쇠 아이콘 묶음. 평소엔 숨었다가 행 hover 또는 잠금/숨김 상태일 때만 노출.
// 부모 행의 클릭(=선택)으로 이벤트가 버블링되지 않도록 stopPropagation.
function LayerActionIcons({
  isHidden,
  isLocked,
  onToggleVisibility,
  onToggleLock,
}: {
  isHidden: boolean;
  isLocked: boolean;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 shrink-0 ml-1">
      <LayerIconButton
        ariaLabel={isHidden ? '레이어 표시' : '레이어 숨기기'}
        active={isHidden}
        onClick={onToggleVisibility}
      >
        {isHidden ? (
          <EyeOff size={12} strokeWidth={1.75} />
        ) : (
          <Eye size={12} strokeWidth={1.75} />
        )}
      </LayerIconButton>
      <LayerIconButton
        ariaLabel={isLocked ? '레이어 잠금 해제' : '레이어 잠금'}
        active={isLocked}
        onClick={onToggleLock}
      >
        {isLocked ? (
          <Lock size={12} strokeWidth={1.75} />
        ) : (
          <Unlock size={12} strokeWidth={1.75} />
        )}
      </LayerIconButton>
    </div>
  );
}

function LayerIconButton({
  ariaLabel,
  active,
  onClick,
  children,
}: {
  ariaLabel: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={(e) => {
        // 행 본체 onClick 까지 버블링되어 선택이 바뀌면 클릭한 행이 항상 단일 선택되어 의도와 어긋난다.
        e.stopPropagation();
        onClick();
      }}
      className={[
        'w-5 h-5 flex items-center justify-center rounded transition-colors',
        // 평소엔 숨김 → 행 hover 시 노출. active(=숨김/잠금) 상태에선 항상 노출해 상태가 보이게.
        active
          ? 'opacity-100 text-foreground'
          : 'opacity-0 group-hover/row:opacity-100 text-[hsl(var(--editor-mute))] hover:text-foreground',
        'hover:bg-black/[0.06]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

// 12×12 미니 SVG 미리보기 — figma 레이어 패널처럼 경로 모양만 보여준다.
// bounding_box 가 SVG ingest 시 {0,0,0,0} 플레이스홀더로 들어오는 케이스가 있어,
// 항상 anchors / handles 좌표로부터 직접 bbox 를 계산한다 (cubic 의 정확한 외접 bbox 는
// 아니지만 control point 를 포함한 외포는 12px 썸네일에 충분).
function PathThumb({ part }: { part: Part }) {
  const d = part.svg_paths?.[0];
  const bb = useMemo(() => computeAnchorsBBox(part), [part]);
  if (!d || !bb) {
    return (
      <span
        aria-hidden="true"
        className="shrink-0 inline-block w-3 h-3 rounded-[2px] border"
        style={{ borderColor: 'hsl(var(--editor-border))' }}
      />
    );
  }
  const padX = bb.width * 0.06;
  const padY = bb.height * 0.06;
  const vbW = bb.width + padX * 2;
  const vbH = bb.height + padY * 2;
  const stroke =
    !part.stroke || part.stroke === 'none' ? 'currentColor' : part.stroke;
  // 레이어 썸네일은 12px 미니 SVG — 그라디언트/패턴은 평균색으로 떨군다.
  const fillCss = fillToCssColor(part.fill);
  const fill = !fillCss || fillCss === 'none' ? 'none' : fillCss;
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox={`${bb.x - padX} ${bb.y - padY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      className="shrink-0 text-[hsl(var(--editor-mute))]"
    >
      {/* non-scaling-stroke 로 strokeWidth=1 이 화면상 1px 가 된다. */}
      <path
        d={d}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function computeAnchorsBBox(part: Part): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  const anchors = part.anchors;
  if (!anchors || anchors.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const a of anchors) {
    if (Number.isFinite(a.x) && Number.isFinite(a.y)) {
      if (a.x < minX) minX = a.x;
      if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y;
      if (a.y > maxY) maxY = a.y;
    }
    if (a.handle_in) {
      if (a.handle_in.x < minX) minX = a.handle_in.x;
      if (a.handle_in.x > maxX) maxX = a.handle_in.x;
      if (a.handle_in.y < minY) minY = a.handle_in.y;
      if (a.handle_in.y > maxY) maxY = a.handle_in.y;
    }
    if (a.handle_out) {
      if (a.handle_out.x < minX) minX = a.handle_out.x;
      if (a.handle_out.x > maxX) maxX = a.handle_out.x;
      if (a.handle_out.y < minY) minY = a.handle_out.y;
      if (a.handle_out.y > maxY) maxY = a.handle_out.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const width = maxX - minX;
  const height = maxY - minY;
  // 점 1개 / 수직선·수평선만 있는 경우에도 viewBox 가 0 이 안 되도록 최소값 보장.
  if (width <= 0 && height <= 0) return null;
  return {
    x: minX,
    y: minY,
    width: Math.max(width, 1),
    height: Math.max(height, 1),
  };
}

// 그룹 행 — chevron + folder 아이콘 + 후손 파트 수 표시. 자식들은 children prop 으로 외부에서 주입.
// 드래그-앤-드롭: 행 상/하 25% 영역은 before/after, 중앙 50% 는 into-group.
function GroupRow({
  groupId,
  depth,
  groupName,
  childCount,
  descendantPartCount,
  anyHidden,
  anyLocked,
  expanded,
  groupSelected,
  groupHasSelection,
  onToggleExpand,
  onSelectGroup,
  onToggleGroupVisibility,
  onToggleGroupLock,
  onRenameGroup,
  ctx,
  children,
}: {
  groupId: string;
  depth: number;
  groupName: string | undefined;
  childCount: number;
  descendantPartCount: number;
  anyHidden: boolean;
  anyLocked: boolean;
  expanded: boolean;
  groupSelected: boolean;
  groupHasSelection: boolean;
  onToggleExpand: () => void;
  onSelectGroup: (mods: { shift: boolean; mod: boolean }) => void;
  onToggleGroupVisibility: () => void;
  onToggleGroupLock: () => void;
  onRenameGroup: (name: string) => void;
  ctx: NodeCtx;
  children: React.ReactNode;
}) {
  const fallbackLabel = '그룹';
  const label = groupName && groupName.length > 0 ? groupName : fallbackLabel;
  const [editing, setEditing] = useState(false);
  void childCount;

  const hover = ctx.dragHover;
  const showBefore =
    hover && hover.kind === 'before' && hover.refKind === 'group' && hover.refId === groupId;
  const showAfter =
    hover && hover.kind === 'after' && hover.refKind === 'group' && hover.refId === groupId;
  const showInto = hover && hover.kind === 'into' && hover.groupId === groupId;

  // 행 영역을 3등분 — 상단 25% before, 하단 25% after, 중앙 50% into-group.
  const onRowDragOver = (e: React.DragEvent) => {
    if (!currentDragInfo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offset = e.clientY - rect.top;
    let target: DropTarget;
    if (offset < rect.height * 0.25) {
      target = { kind: 'before', refKind: 'group', refId: groupId };
    } else if (offset > rect.height * 0.75) {
      target = { kind: 'after', refKind: 'group', refId: groupId };
    } else {
      target = { kind: 'into', groupId };
    }
    if (ctx.isInvalidTarget(target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const same =
      hover &&
      ((target.kind === 'into' &&
        hover.kind === 'into' &&
        hover.groupId === groupId) ||
        (target.kind !== 'into' &&
          hover.kind === target.kind &&
          (hover as { refKind?: string }).refKind === 'group' &&
          (hover as { refId?: string }).refId === groupId));
    if (!same) ctx.setDragHover(target);
  };

  const onRowDrop = (e: React.DragEvent) => {
    if (!currentDragInfo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offset = e.clientY - rect.top;
    let target: DropTarget;
    if (offset < rect.height * 0.25) {
      target = { kind: 'before', refKind: 'group', refId: groupId };
    } else if (offset > rect.height * 0.75) {
      target = { kind: 'after', refKind: 'group', refId: groupId };
    } else {
      target = { kind: 'into', groupId };
    }
    if (ctx.isInvalidTarget(target)) return;
    e.preventDefault();
    e.stopPropagation();
    ctx.onDropTarget(target);
  };

  return (
    <li
      role="treeitem"
      aria-selected={groupSelected}
      aria-expanded={expanded}
      style={{ position: 'relative' }}
    >
      <div
        draggable={!editing}
        onDragStart={(e) => ctx.onDragStart(e, { kind: 'group', id: groupId })}
        onDragEnd={ctx.onDragEnd}
        onDragOver={onRowDragOver}
        onDrop={onRowDrop}
        className={[
          'group/row w-full flex items-center pr-2 h-7 transition-colors',
          showInto
            ? 'bg-[#3884ff]/[0.12] text-foreground'
            : groupSelected
              ? 'bg-black/[0.06] text-foreground'
              : groupHasSelection
                ? 'bg-black/[0.03] text-foreground/90'
                : 'text-foreground/85 hover:bg-black/[0.04]',
        ].join(' ')}
        style={{
          fontSize: '12px',
          fontWeight: groupSelected ? 500 : 400,
          letterSpacing: '-0.14px',
          paddingLeft: depth * 12,
          // into 상태일 때 그룹 전체에 파란 외곽선을 둘러 시각적으로 구분.
          boxShadow: showInto ? 'inset 0 0 0 1px #3884ff' : undefined,
        }}
      >
        <button
          type="button"
          aria-label={expanded ? '그룹 접기' : '그룹 펼치기'}
          onClick={onToggleExpand}
          className="w-5 h-7 flex items-center justify-center shrink-0 text-[hsl(var(--editor-mute))] hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown size={12} strokeWidth={1.75} />
          ) : (
            <ChevronRight size={12} strokeWidth={1.75} />
          )}
        </button>
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            if (editing) return;
            onSelectGroup({ shift: e.shiftKey, mod: e.metaKey || e.ctrlKey });
          }}
          onKeyDown={(e) => {
            if (editing) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectGroup({ shift: e.shiftKey, mod: e.metaKey || e.ctrlKey });
            }
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEditing(true);
          }}
          className="flex-1 min-w-0 flex items-center gap-2 text-left h-7 cursor-default"
          title={`${label} (${descendantPartCount}개)`}
          style={{ opacity: anyHidden ? 0.45 : 1 }}
        >
          <Folder
            size={12}
            strokeWidth={1.5}
            className="shrink-0 text-[hsl(var(--editor-mute))]"
          />
          {editing ? (
            <InlineRenameLabel
              initial={label}
              onCommit={(value) => {
                if (value === fallbackLabel) onRenameGroup('');
                else onRenameGroup(value);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <span className="truncate flex-1">{label}</span>
              <span className="label-mono text-[hsl(var(--editor-mute))]">
                {descendantPartCount}
              </span>
            </>
          )}
        </div>
        <LayerActionIcons
          isHidden={anyHidden}
          isLocked={anyLocked}
          onToggleVisibility={onToggleGroupVisibility}
          onToggleLock={onToggleGroupLock}
        />
      </div>
      {showBefore ? <DropLine position="top" depth={depth} /> : null}
      {showAfter ? <DropLine position="bottom" depth={depth} /> : null}
      {expanded && <ul role="group">{children}</ul>}
    </li>
  );
}

function EmptyState() {
  return (
    <div className="px-3 py-6 flex flex-col items-center text-center gap-2">
      <LayersIcon
        size={20}
        strokeWidth={1.25}
        className="text-[hsl(var(--editor-mute))]"
      />
      <p
        className="text-[11px] text-[hsl(var(--editor-mute))] leading-relaxed"
        style={{ letterSpacing: '-0.14px' }}
      >
        레이어가 아직 없습니다.
        <br />
        사진을 업로드하면 도식화가 생성됩니다.
      </p>
    </div>
  );
}

