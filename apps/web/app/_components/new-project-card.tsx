'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function NewProjectCard({
  variant = 'grid',
}: {
  variant?: 'grid' | 'recent';
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '제목 없음' }),
      });
      if (!res.ok) {
        console.error('프로젝트 생성 실패', res.status);
        return;
      }
      const { project } = (await res.json()) as { project: { id: string } };
      // 홈(/) RSC 목록을 무효화 — 뒤로가기 시 새 프로젝트가 빠진 stale 목록이
      // 보이지 않게 한다 (project-card 삭제 경로와 동일 패턴).
      router.refresh();
      router.push(`/projects/${project.id}`);
    } catch (err) {
      console.error('프로젝트 생성 중 오류', err);
    } finally {
      setLoading(false);
    }
  }

  const wrapperClass =
    variant === 'recent'
      ? 'group block w-[260px] shrink-0 text-left'
      : 'group block w-full text-left';

  return (
    <button type="button" onClick={handleClick} disabled={loading} className={wrapperClass}>
      <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-[#D4D4D4] bg-white transition-colors group-hover:border-[#1E1E1E]/40 group-hover:bg-[#FAFAFA]">
        <div className="flex flex-col items-center gap-2 text-[#737373] group-hover:text-[#1E1E1E]">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.06] group-hover:bg-black/10">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
              <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" />
            </svg>
          </div>
          <span className="text-[12px] tracking-tight">
            {loading ? '생성 중...' : '새 프로젝트'}
          </span>
        </div>
      </div>
      <div className="px-1 pt-3">
        <p className="truncate text-[13px] font-medium tracking-tight text-[#1E1E1E]">
          새 도식화 프로젝트
        </p>
        <p className="truncate pt-0.5 text-[11px] tracking-tight text-[#A3A3A3]">
          빈 캔버스에서 시작
        </p>
      </div>
    </button>
  );
}
