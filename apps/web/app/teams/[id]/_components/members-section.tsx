'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { TeamRole } from '@/lib/api/teams';
import { roleAtLeast } from '@/lib/api/teams';

type Member = {
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  email: string | null;
  created_at: string;
};

// 팀 멤버 목록. admin 이상은 타인 제거, 본인 행은 탈퇴(owner 제외).
export function MembersSection({
  teamId,
  currentUserId,
  currentRole,
  members,
}: {
  teamId: string;
  currentUserId: string;
  currentRole: TeamRole;
  members: Member[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const canManage = roleAtLeast(currentRole, 'admin');

  async function remove(member: Member, isSelf: boolean) {
    if (member.role === 'owner') return;
    const verb = isSelf ? '팀에서 나갈까요?' : `${member.email ?? '이 멤버'}를 팀에서 제거할까요?`;
    if (!confirm(verb)) return;
    setBusyId(member.user_id);
    try {
      const res = await fetch(`/api/teams/${teamId}/members/${member.user_id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ?? '실패',
        );
      }
      if (isSelf) {
        router.push('/');
      } else {
        router.refresh();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '실패');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-[15px] font-medium tracking-tight text-[#1E1E1E]">멤버</h2>
      <ul className="divide-y divide-[#EAEAEA] rounded-lg border border-[#EAEAEA]">
        {members.map((m) => {
          const isSelf = m.user_id === currentUserId;
          const canRemoveOther = canManage && !isSelf && m.role !== 'owner';
          const canLeave = isSelf && m.role !== 'owner';
          return (
            <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-[12px] font-medium text-white">
                {(m.email ?? '?').charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium tracking-tight text-[#1E1E1E]">
                  {m.email ?? '(이메일 없음)'}
                  {isSelf ? (
                    <span className="ml-2 text-[11px] text-[#A3A3A3]">나</span>
                  ) : null}
                </p>
                <p className="text-[11px] tracking-tight text-[#A3A3A3]">
                  {m.role === 'owner' ? '소유자' : m.role === 'admin' ? '관리자' : '멤버'}
                </p>
              </div>
              {canRemoveOther ? (
                <button
                  type="button"
                  disabled={busyId === m.user_id}
                  onClick={() => remove(m, false)}
                  className="rounded-md border border-[#EAEAEA] px-2.5 py-1 text-[12px] tracking-tight text-[#525252] hover:bg-black/[0.04] hover:text-[#1E1E1E] disabled:opacity-60"
                >
                  {busyId === m.user_id ? '처리 중…' : '제거'}
                </button>
              ) : null}
              {canLeave ? (
                <button
                  type="button"
                  disabled={busyId === m.user_id}
                  onClick={() => remove(m, true)}
                  className="rounded-md border border-[#EAEAEA] px-2.5 py-1 text-[12px] tracking-tight text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  {busyId === m.user_id ? '처리 중…' : '팀 나가기'}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
