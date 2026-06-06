'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Invitation = {
  id: string;
  email: string;
  role: 'admin' | 'member';
  status: string;
  created_at: string;
  expires_at: string;
};

// 초대 발급 + 대기 중 초대 목록. admin 이상만 본다.
// 초대 발급 응답에 acceptUrl, emailSent 가 들어오므로 "링크 복사"를 항상 제공한다.
export function InvitationsSection({
  teamId,
  initialInvitations,
}: {
  teamId: string;
  initialInvitations: Invitation[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<{
    email: string;
    acceptUrl: string;
    emailSent: boolean;
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError('이메일을 입력하세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${teamId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ??
            `초대 실패 (${res.status})`,
        );
      }
      const result = body as { acceptUrl: string; emailSent: boolean };
      setLastInvite({ email: trimmed, acceptUrl: result.acceptUrl, emailSent: result.emailSent });
      setEmail('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '초대 중 오류');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invitationId: string) {
    if (!confirm('이 초대를 철회할까요?')) return;
    try {
      const res = await fetch(
        `/api/teams/${teamId}/invitations/${invitationId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('철회 실패');
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : '실패');
    }
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).then(
      () => {},
      () => alert(`복사 실패. 직접 복사하세요: ${url}`),
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-[15px] font-medium tracking-tight text-[#1E1E1E]">초대</h2>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-lg border border-[#EAEAEA] p-4">
        <div className="min-w-[220px] flex-1">
          <label className="block text-[12px] tracking-tight text-[#525252]">이메일</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            placeholder="invite@example.com"
            className="mt-1 w-full rounded-md border border-[#EAEAEA] px-3 py-2 text-[13px] tracking-tight text-[#1E1E1E] focus:border-[#1E1E1E]/40 focus:outline-none disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-[12px] tracking-tight text-[#525252]">역할</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
            disabled={busy}
            className="mt-1 rounded-md border border-[#EAEAEA] bg-white px-3 py-2 text-[13px] tracking-tight text-[#1E1E1E] focus:border-[#1E1E1E]/40 focus:outline-none disabled:opacity-60"
          >
            <option value="member">멤버</option>
            <option value="admin">관리자</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="rounded-md bg-[#1E1E1E] px-3 py-2 text-[13px] font-medium tracking-tight text-white hover:bg-black disabled:opacity-60"
        >
          {busy ? '발송 중…' : '초대 보내기'}
        </button>
      </form>

      {error ? <p className="text-[12px] text-red-600">{error}</p> : null}

      {lastInvite ? (
        <div className="rounded-md border border-[#EAEAEA] bg-[#FAFAFA] p-3 text-[12px] tracking-tight text-[#525252]">
          <p>
            <strong>{lastInvite.email}</strong> 에게 초대를 발급했습니다.
            {lastInvite.emailSent
              ? ' 초대 메일이 전송되었습니다.'
              : ' (메일 발송에 실패했거나 이미 가입한 사용자입니다. 아래 링크를 직접 공유하세요.)'}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              readOnly
              value={lastInvite.acceptUrl}
              className="flex-1 rounded border border-[#EAEAEA] bg-white px-2 py-1 text-[12px] text-[#1E1E1E]"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={() => copyLink(lastInvite.acceptUrl)}
              className="rounded border border-[#EAEAEA] bg-white px-2.5 py-1 text-[12px] text-[#525252] hover:bg-black/[0.04] hover:text-[#1E1E1E]"
            >
              링크 복사
            </button>
          </div>
        </div>
      ) : null}

      {initialInvitations.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[12px] tracking-tight text-[#737373]">대기 중인 초대</p>
          <ul className="divide-y divide-[#EAEAEA] rounded-lg border border-[#EAEAEA]">
            {initialInvitations.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] tracking-tight text-[#1E1E1E]">{inv.email}</p>
                  <p className="text-[11px] tracking-tight text-[#A3A3A3]">
                    {inv.role === 'admin' ? '관리자' : '멤버'} · 만료 {new Date(inv.expires_at).toLocaleDateString('ko-KR')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(inv.id)}
                  className="rounded-md border border-[#EAEAEA] px-2.5 py-1 text-[12px] tracking-tight text-[#525252] hover:bg-black/[0.04] hover:text-[#1E1E1E]"
                >
                  철회
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
