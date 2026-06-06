'use client';
// 캔버스 우클릭 컨텍스트 메뉴 — figma_click_refer.png 톤(다크 회색·둥근 모서리·은은한 보더)을 따른다.
// 표시 위치는 부모(canvas-panel)가 화면(window) 좌표로 전달. portal 없이 fixed 포지셔닝으로 띄우고
// 외부 클릭 / Esc / 스크롤로 자동 닫힘.

import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  /** 메뉴에 보일 라벨 — 한글. */
  label: string;
  /** 우측에 회색으로 보이는 단축키 표기. 없으면 빈 칸. */
  shortcut?: string;
  /** 클릭 시 실행. 항목이 disabled면 호출되지 않는다. */
  onSelect?: () => void;
  /** 회색 처리 + 클릭 무시. 선택이 1개 이하인데 그룹화 등 N개 필요한 항목용. */
  disabled?: boolean;
}

export interface ContextMenuSection {
  items: ContextMenuItem[];
}

interface ContextMenuProps {
  /** window 좌표(clientX/Y). */
  x: number;
  y: number;
  sections: ContextMenuSection[];
  onClose: () => void;
}

const MENU_WIDTH = 240;

export function ContextMenu({ x, y, sections, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // 외부 클릭 / Esc / 스크롤 / 리사이즈 → 닫기.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onScrollOrResize() {
      onClose();
    }
    // capture로 받아 다른 캔버스 핸들러보다 먼저 닫는다.
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('wheel', onScrollOrResize, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('wheel', onScrollOrResize);
    };
  }, [onClose]);

  // 화면 우/하단을 넘어가면 위쪽 또는 왼쪽으로 뒤집기.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  // 메뉴 높이는 항목 수에 따라 가변 — 대략적 추정으로 컷오프 판단.
  const approxHeight =
    sections.reduce((sum, s) => sum + s.items.length, 0) * 28 +
    (sections.length - 1) * 9 +
    12;
  const left = x + MENU_WIDTH > vw ? Math.max(8, vw - MENU_WIDTH - 8) : x;
  const top = y + approxHeight > vh ? Math.max(8, vh - approxHeight - 8) : y;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="컨텍스트 메뉴"
      // 다크 톤(#2C2C2C 계열)·8px 라운드·은은한 보더와 그림자 — figma 레퍼런스 컬러 매칭.
      className="fixed z-[100] py-1.5 select-none"
      style={{
        left,
        top,
        width: MENU_WIDTH,
        backgroundColor: '#2C2C2C',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 8,
        boxShadow:
          '0 12px 28px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3)',
        color: '#E6E6E6',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {sections.map((section, i) => (
        <div key={i}>
          {i > 0 && (
            <div
              aria-hidden="true"
              className="my-1 mx-2"
              style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }}
            />
          )}
          {section.items.map((item, j) => (
            <button
              key={j}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                item.onSelect?.();
                onClose();
              }}
              className="w-full flex items-center justify-between text-left px-3 h-7 text-[12px] transition-colors disabled:cursor-not-allowed"
              style={{
                letterSpacing: '-0.14px',
                color: item.disabled ? 'rgba(230,230,230,0.35)' : '#E6E6E6',
              }}
              onMouseEnter={(e) => {
                if (item.disabled) return;
                e.currentTarget.style.backgroundColor = '#0D6CE0';
                e.currentTarget.style.color = '#FFFFFF';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = item.disabled
                  ? 'rgba(230,230,230,0.35)'
                  : '#E6E6E6';
              }}
            >
              <span>{item.label}</span>
              {item.shortcut ? (
                <span
                  className="text-[11px]"
                  style={{
                    color: 'inherit',
                    opacity: item.disabled ? 1 : 0.55,
                    letterSpacing: '-0.1px',
                    marginLeft: 12,
                  }}
                >
                  {item.shortcut}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
