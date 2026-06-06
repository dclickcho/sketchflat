'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { TeamRole } from '@/lib/api/teams';
import { roleAtLeast } from '@/lib/api/teams';

// 팀 페이지 상단: 이름(인라인 편집 — admin 이상), 멤버 수, owner 의 팀 삭제 버튼.
export function TeamHeader({
  team,
  role,
  memberCount,
}: {
  team: { id: string; name: string };
  role: TeamRole;
  memberCount: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [busy, setBusy] = useState(false);
  const canEdit = roleAtLeast(role, 'admin');
  const canDelete = role === 'owner';

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === team.name) {
      setEditing(false);
      setName(team.name);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/teams/${team.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error('이름 변경 실패');
      setEditing(false);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : '이름 변경 중 오류');
      setName(team.name);
    } finally {
      setBusy(false);
    }
  }

  async function deleteTeam() {
    if (!confirm(`"${team.name}" 팀을 삭제할까요? 멤버·초대·팀 라이브러리가 모두 삭제되고, 팀 프로젝트는 어디에도 속하지 않게 됩니다.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/teams/${team.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('팀 삭제 실패');
      router.push('/');
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : '팀 삭제 중 오류');
      setBusy(false);
    }
  }

  return (
    <header className="flex items-end justify-between gap-4 border-b border-[#EAEAEA] pb-6">
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName();
              if (e.key === 'Escape') {
                setEditing(false);
                setName(team.name);
              }
            }}
            disabled={busy}
            autoFocus
            className="w-full max-w-[480px] rounded-md border border-[#EAEAEA] px-3 py-1.5 text-[22px] font-semibold tracking-tight text-[#1E1E1E] focus:border-[#1E1E1E]/40 focus:outline-none disabled:opacity-60"
          />
        ) : (
          <h1
            className={`truncate text-[22px] font-semibold tracking-tight text-[#1E1E1E] ${
              canEdit ? 'cursor-text rounded-md px-1 hover:bg-black/[0.04]' : ''
            }`}
            onClick={() => canEdit && setEditing(true)}
            title={canEdit ? '클릭해서 이름 변경' : undefined}
          >
            {team.name}
          </h1>
        )}
        <p className="mt-1 px-1 text-[12px] tracking-tight text-[#737373]">
          멤버 {memberCount}명 · 내 역할: <RoleBadge role={role} />
        </p>
      </div>
      {canDelete ? (
        <button
          type="button"
          disabled={busy}
          onClick={deleteTeam}
          className="rounded-md border border-[#EAEAEA] px-3 py-1.5 text-[13px] tracking-tight text-red-600 hover:bg-red-50 disabled:opacity-60"
        >
          팀 삭제
        </button>
      ) : null}
    </header>
  );
}

function RoleBadge({ role }: { role: TeamRole }) {
  const label = role === 'owner' ? '소유자' : role === 'admin' ? '관리자' : '멤버';
  return (
    <span className="ml-1 rounded bg-[#F4F4F4] px-1.5 py-0.5 text-[11px] font-medium text-[#525252]">
      {label}
    </span>
  );
}
