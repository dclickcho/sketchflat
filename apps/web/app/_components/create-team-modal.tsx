'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

// 사이드바 "새 팀 만들기" 버튼이 띄우는 모달. 팀 이름만 받고 POST /api/teams.
// 성공 시 새 팀 상세 페이지로 이동 (router.push) + router.refresh 로 사이드바 갱신.
export function CreateTeamModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setName('');
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('팀 이름을 입력하세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ??
            `팀 생성 실패 (${res.status})`,
        );
      }
      const team = (body as { team: { id: string } }).team;
      onClose();
      router.push(`/teams/${team.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '팀 생성 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-[360px] rounded-xl bg-white p-6 shadow-2xl"
      >
        <h2 className="text-[15px] font-medium tracking-tight text-[#1E1E1E]">
          새 팀 만들기
        </h2>
        <p className="mt-1 text-[12px] text-[#737373]">
          팀은 프로젝트와 SVG 라이브러리를 멤버들과 함께 공유합니다.
        </p>
        <label className="mt-4 block text-[12px] tracking-tight text-[#525252]">
          팀 이름
        </label>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          maxLength={100}
          placeholder="예: 디자인팀"
          className="mt-1 w-full rounded-md border border-[#EAEAEA] px-3 py-2 text-[13px] tracking-tight text-[#1E1E1E] focus:border-[#1E1E1E]/40 focus:outline-none disabled:opacity-60"
        />
        {error ? (
          <p className="mt-2 text-[12px] text-red-600">{error}</p>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[13px] tracking-tight text-[#525252] hover:bg-black/[0.04] disabled:opacity-60"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-md bg-[#1E1E1E] px-3 py-1.5 text-[13px] font-medium tracking-tight text-white hover:bg-black disabled:opacity-60"
          >
            {busy ? '생성 중…' : '만들기'}
          </button>
        </div>
      </form>
    </div>
  );
}
