'use client';

import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export type SortKey = 'alpha' | 'created' | 'updated';
export type SortOrder = 'asc' | 'desc';

const KEY_LABEL: Record<SortKey, string> = {
  alpha: '알파벳순',
  created: '생성일',
  updated: '마지막으로 수정됨',
};

const ORDER_LABEL: Record<SortOrder, string> = {
  asc: '가장 오래된 순',
  desc: '최신순',
};

export function SortMenu({ sort, order }: { sort: SortKey; order: SortOrder }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function apply(next: { sort?: SortKey; order?: SortOrder }) {
    const sp = new URLSearchParams(params?.toString() ?? '');
    const nextSort = next.sort ?? sort;
    const nextOrder = next.order ?? order;
    // 기본값은 URL에서 생략해 깔끔하게 유지한다.
    if (nextSort === 'updated') sp.delete('sort');
    else sp.set('sort', nextSort);
    if (nextOrder === 'desc') sp.delete('order');
    else sp.set('order', nextOrder);
    const qs = sp.toString();
    // 쿼리스트링이 동적이라 typedRoutes 정적 분석 대상이 아님 → Route 로 캐스팅.
    const href = (qs ? `${pathname}?${qs}` : pathname) as Route;
    router.replace(href, { scroll: false });
  }

  // 기본값(updated + desc)에서는 기존 표기를 유지하고, 그 외에는 선택한 기준을 노출한다.
  const label =
    sort === 'updated' && order === 'desc'
      ? '최근 업데이트순'
      : `${KEY_LABEL[sort]} · ${ORDER_LABEL[order]}`;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-black/[0.04] hover:text-[#1E1E1E]"
      >
        {label}
        <ChevronIcon className="h-3 w-3" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-8 z-20 min-w-[180px] overflow-hidden rounded-md border border-[#EAEAEA] bg-white py-1 text-[#1E1E1E] shadow-lg"
        >
          <p className="px-3 pb-1 pt-1.5 text-[11px] tracking-tight text-[#A3A3A3]">
            정렬 기준
          </p>
          {(Object.keys(KEY_LABEL) as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              role="menuitemradio"
              aria-checked={sort === k}
              onClick={() => apply({ sort: k })}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-black/[0.04]"
            >
              <span className="flex w-3 justify-center">
                {sort === k ? <CheckIcon className="h-3 w-3" /> : null}
              </span>
              <span className="flex-1">{KEY_LABEL[k]}</span>
            </button>
          ))}
          <div className="my-1 h-px bg-[#EAEAEA]" />
          <p className="px-3 pb-1 pt-1.5 text-[11px] tracking-tight text-[#A3A3A3]">
            순서
          </p>
          {(Object.keys(ORDER_LABEL) as SortOrder[]).map((o) => (
            <button
              key={o}
              type="button"
              role="menuitemradio"
              aria-checked={order === o}
              onClick={() => apply({ order: o })}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-black/[0.04]"
            >
              <span className="flex w-3 justify-center">
                {order === o ? <CheckIcon className="h-3 w-3" /> : null}
              </span>
              <span className="flex-1">{ORDER_LABEL[o]}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChevronIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
