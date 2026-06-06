'use client';
// 전체 에디터 레이아웃 조립 — 상태(useEditorStore)와 dynamic import가 필요해 Client Component.

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import { LeftPanel, LogoMenu } from './left-panel';
import { RightPanel } from './right-panel';
import { FloatingToolbar } from './floating-toolbar';
import { useAutosaveSketch } from '@/lib/use-autosave-sketch';
import { useEditorStore } from '@/lib/editor-store';
import { loadUiPrefs, saveUiPrefs } from '@/lib/web-storage';

// react-konva는 window/document에 의존해 SSR 불가 → ssr: false.
const CanvasPanel = dynamic(() => import('./canvas-panel'), {
  ssr: false,
  loading: () => <CanvasLoading />,
});

function CanvasLoading() {
  return (
    <div
      className="flex flex-1 items-center justify-center"
      style={{ backgroundColor: 'hsl(var(--editor-bg))' }}
    >
      <p
        className="text-[12px] text-[hsl(var(--editor-mute))]"
        style={{ letterSpacing: '-0.14px' }}
      >
        캔버스 로드 중...
      </p>
    </div>
  );
}

interface EditorShellProps {
  projectId: string;
  initialTitle: string;
  userInitial: string;
}

export function EditorShell({ projectId, initialTitle, userInitial }: EditorShellProps) {
  // sketch가 변경되면 디바운스해 PATCH /api/projects/[id]로 자동저장.
  useAutosaveSketch(projectId);
  // 빈 영역 우클릭 → "UI 숨기기"로 토글되는 플래그. true면 좌/우 패널 + 플로팅 툴바를 언마운트해 캔버스만 남긴다.
  const hideUI = useEditorStore((s) => s.hideUI);
  // 좌측 패널 헤더의 minimize 버튼 → "UI 최소화". 좌/우 패널 모두 미니 박스(332×48)로 축소되고 플로팅 툴바는 유지.
  const uiMinimized = useEditorStore((s) => s.uiMinimized);
  // hideUI가 우선 — 둘 다 켜져 있으면 hideUI(완전 숨김)을 따른다.
  const showLeftRight = !hideUI && !uiMinimized;

  // UI 환경설정(localStorage) — 최초 마운트 시 저장된 UI 최소화 상태를 복원.
  useEffect(() => {
    const prefs = loadUiPrefs();
    if (prefs?.uiMinimized && !useEditorStore.getState().uiMinimized) {
      useEditorStore.getState().toggleUIMinimized();
    }
  }, []);
  // 변경 시 localStorage 에 저장 — 새로고침·재접속 후에도 UI 레이아웃 유지.
  useEffect(() => {
    saveUiPrefs({ uiMinimized });
  }, [uiMinimized]);

  return (
    <div
      className="h-screen w-screen flex overflow-hidden"
      style={{ backgroundColor: 'hsl(var(--editor-bg))' }}
    >
      {showLeftRight && <LeftPanel projectId={projectId} initialTitle={initialTitle} />}

      <main className="flex-1 relative overflow-hidden">
        <CanvasPanel projectId={projectId} />
        {!hideUI && uiMinimized && (
          <>
            <MiniHeader title={initialTitle} />
            <MiniRightHeader userInitial={userInitial} />
          </>
        )}
        {!hideUI && <FloatingToolbar />}
      </main>

      {showLeftRight && <RightPanel userInitial={userInitial} />}
    </div>
  );
}

// 최소화 모드의 좌측 미니 헤더 — 332×48 박스. 좌측에 기존 LogoMenu(로고+아래화살표) 그대로,
// 가운데 프로젝트명, 우측에 UI 펼치기 버튼.
function MiniHeader({ title }: { title: string }) {
  const toggleUIMinimized = useEditorStore((s) => s.toggleUIMinimized);
  return (
    <div
      className="absolute left-3 top-3 z-30 flex items-center rounded-md bg-white border shadow-sm pointer-events-auto"
      style={{
        width: 240,
        height: 48,
        borderColor: 'hsl(var(--editor-border))',
      }}
    >
      <LogoMenu />
      <span
        className="flex-1 min-w-0 px-1 truncate text-[13px] text-foreground"
        style={{ fontWeight: 500, letterSpacing: '-0.14px' }}
        title={title}
      >
        {title}
      </span>
      <button
        type="button"
        onClick={toggleUIMinimized}
        aria-label="UI 펼치기"
        title="UI 펼치기"
        className="mr-2 w-6 h-6 shrink-0 flex items-center justify-center rounded text-[hsl(var(--editor-mute))] hover:text-foreground hover:bg-black/[0.06] transition-colors"
      >
        <PanelLeftOpen size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

// 최소화 모드의 우측 미니 헤더 — 좌측과 동일한 332×48 박스. 프로필 아바타 + 공유하기 버튼.
function MiniRightHeader({ userInitial }: { userInitial: string }) {
  function handleShare() {
    console.log('공유하기 — 추후 구현');
  }
  return (
    <div
      className="absolute right-3 top-3 z-30 flex items-center justify-between rounded-md bg-white border shadow-sm pointer-events-auto"
      style={{
        width: 240,
        height: 48,
        borderColor: 'hsl(var(--editor-border))',
      }}
    >
      <button
        type="button"
        aria-label="프로필"
        className="ml-3 w-7 h-7 shrink-0 rounded-full bg-emerald-500 text-white text-[12px] font-semibold flex items-center justify-center hover:opacity-90 transition-opacity"
      >
        {userInitial}
      </button>
      <button
        type="button"
        onClick={handleShare}
        className="mr-3 rounded-md bg-black px-3 h-7 text-[12px] text-white hover:bg-black/85 transition-colors"
        style={{ fontWeight: 500, letterSpacing: '-0.14px' }}
      >
        공유하기
      </button>
    </div>
  );
}
