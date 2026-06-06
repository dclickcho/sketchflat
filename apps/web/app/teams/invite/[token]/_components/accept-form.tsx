'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// 초대 수락 클라이언트 액션. 성공 시 팀 페이지로 이동.
export function AcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invitations/${token}/accept`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ??
            `수락 실패 (${res.status})`,
        );
      }
      const teamId = (body as { team_id: string }).team_id;
      router.push(`/teams/${teamId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '수락 중 오류');
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 space-y-2">
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="w-full rounded-md bg-[#1E1E1E] px-4 py-2 text-[13px] font-medium tracking-tight text-white hover:bg-black disabled:opacity-60"
      >
        {busy ? '수락 중…' : '팀 합류하기'}
      </button>
      {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
    </div>
  );
}
