'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

export type SearchProject = {
  id: string;
  title: string | null;
  updated_at: string | null;
  // 팀 프로젝트면 팀 이름, 개인 프로젝트면 null.
  teamName: string | null;
};

const MAX_RESULTS = 5;

// 사이드바 상단 검색. 입력 즉시 클라이언트에서 제목으로 필터링해 드롭다운으로 보여주고,
// "모든 결과 보기"는 /?q=... 로 이동해 전체 결과 그리드(page.tsx)를 연다.
export function ProjectSearch({
  projects,
  initialQuery = '',
}: {
  projects: SearchProject[];
  initialQuery?: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    return projects.filter((p) =>
      (p.title ?? '제목 없음').toLowerCase().includes(q),
    );
  }, [projects, q]);
  const visible = results.slice(0, MAX_RESULTS);

  const showDropdown = open && q.length > 0;

  // 외부 클릭·Esc 로 드롭다운 닫기.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function submitAll() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setOpen(false);
    router.push(`/?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`flex items-center gap-2.5 rounded-md bg-white px-3 py-1.5 ring-1 transition-all ${
          showDropdown
            ? 'ring-[#0D99FF]'
            : 'ring-[#EAEAEA] focus-within:ring-[#0D99FF]'
        }`}
      >
        <SearchIcon className="h-3.5 w-3.5 shrink-0 text-[#A3A3A3]" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitAll();
          }}
          placeholder="검색"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] tracking-tight text-[#1E1E1E] placeholder:text-[#A3A3A3] focus:outline-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setOpen(true);
              inputRef.current?.focus();
            }}
            aria-label="검색어 지우기"
            className="shrink-0 rounded text-[#A3A3A3] hover:text-[#1E1E1E]"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {showDropdown ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-[#EAEAEA] bg-white py-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
          {visible.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12.5px] tracking-tight text-[#A3A3A3]">
              검색 결과가 없습니다.
            </p>
          ) : (
            <ul>
              {visible.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-black/[0.04]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#EAF3FF] text-[#0D99FF]">
                      <FileIcon className="h-4 w-4" />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-medium tracking-tight text-[#1E1E1E]">
                        {p.title?.trim() || '제목 없음'}
                      </span>
                      <span className="truncate text-[11.5px] tracking-tight text-[#A3A3A3]">
                        {p.teamName ?? '개인 프로젝트'} · {formatRelativeTime(p.updated_at)} 편집됨
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 border-t border-[#EAEAEA] pt-1">
            <button
              type="button"
              onClick={submitAll}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium tracking-tight text-[#0D99FF] hover:bg-[#EAF3FF]"
            >
              <SearchIcon className="h-3.5 w-3.5 shrink-0" />
              <span>모든 결과 보기</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '방금 전';
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHour < 24) return `${diffHour}시간 전`;
  if (diffDay < 7) return `${diffDay}일 전`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}주 전`;
  return date.toLocaleDateString('ko-KR');
}

function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" strokeLinecap="round" />
    </svg>
  );
}

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

function FileIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
      <path
        d="M4 2.5h4.5L12 6v7.5A1 1 0 0 1 11 14.5H4A1 1 0 0 1 3 13.5v-10A1 1 0 0 1 4 2.5Z"
        strokeLinejoin="round"
      />
      <path d="M8.5 2.5V6H12" strokeLinejoin="round" />
    </svg>
  );
}
