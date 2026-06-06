'use client';
// router.push와 fetch가 필요하므로 Client Component.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function NewProjectButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '새 프로젝트' }),
      });
      if (!res.ok) {
        console.error('프로젝트 생성 실패', res.status);
        return;
      }
      const { project } = (await res.json()) as { project: { id: string } };
      // 홈(/) RSC 목록 무효화 — 뒤로가기 시 새 프로젝트 누락 stale 목록 방지.
      router.refresh();
      router.push(`/projects/${project.id}`);
    } catch (err) {
      console.error('프로젝트 생성 중 오류', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
    >
      {loading ? '생성 중...' : '+ 새 프로젝트'}
    </button>
  );
}
