'use client';

import { useEffect, useRef, useState } from 'react';

type NotificationTab = 'all' | 'unread';

export function NotificationsMenu() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<NotificationTab>('all');

  // 외부 클릭·Esc 로 닫기 — 프로필 메뉴와 동일한 동작.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
          open
            ? 'bg-black/[0.06] text-[#1E1E1E]'
            : 'text-[#525252] hover:bg-black/[0.04] hover:text-[#1E1E1E]'
        }`}
        aria-label="알림"
        aria-expanded={open}
      >
        <BellIcon className="h-4 w-4" />
      </button>

      {open ? (
        <div
          className="absolute left-0 top-10 z-50 w-[380px] overflow-hidden rounded-xl bg-white text-[#1E1E1E] shadow-2xl ring-1 ring-black/10"
          role="dialog"
          aria-label="모든 알림"
        >
          {/* 헤더: 제목 + 설정 */}
          <div className="flex items-center justify-between px-4 pb-3 pt-4">
            <h2 className="text-[15px] font-semibold tracking-tight text-[#1E1E1E]">
              모든 알림
            </h2>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[#525252] hover:bg-black/[0.04] hover:text-[#1E1E1E]"
              aria-label="알림 설정"
            >
              <SettingsIcon className="h-[17px] w-[17px]" />
            </button>
          </div>

          {/* 탭: 전체 / 읽지 않음 */}
          <div className="flex items-center gap-1 border-b border-[#EAEAEA] px-3">
            <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
              전체
            </TabButton>
            <TabButton active={tab === 'unread'} onClick={() => setTab('unread')}>
              읽지 않음
            </TabButton>
          </div>

          {/* 빈 상태 */}
          <div className="flex h-[200px] items-center justify-center px-4">
            <p className="text-[13px] tracking-tight text-[#A3A3A3]">
              알림이 없습니다.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative -mb-px px-2 py-2 text-[13px] tracking-tight transition-colors ${
        active
          ? 'font-medium text-[#1E1E1E]'
          : 'text-[#A3A3A3] hover:text-[#525252]'
      }`}
    >
      {children}
      {active ? (
        <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#1E1E1E]" />
      ) : null}
    </button>
  );
}

function BellIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
      <path
        d="M8 2c-2.2 0-3.6 1.6-3.6 3.8 0 2.7-.6 3.6-1.4 4.5-.3.4 0 .9.5.9h9c.5 0 .8-.5.5-.9-.8-.9-1.4-1.8-1.4-4.5C11.6 3.6 10.2 2 8 2Z"
        strokeLinejoin="round"
      />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
      <circle cx="8" cy="8" r="2" />
      <path
        d="M13 8c0-.3 0-.6-.07-.9l1.5-1.16-1.5-2.6-1.78.7a4.6 4.6 0 0 0-1.55-.9L9.3 1H6.7l-.3 2.14c-.56.22-1.08.52-1.55.9l-1.78-.7-1.5 2.6 1.5 1.16C3.03 7.4 3 7.7 3 8s.03.6.07.9L1.57 10.06l1.5 2.6 1.78-.7c.47.38.99.68 1.55.9l.3 2.14h2.6l.3-2.14a4.6 4.6 0 0 0 1.55-.9l1.78.7 1.5-2.6-1.5-1.16c.04-.3.07-.6.07-.9Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}
