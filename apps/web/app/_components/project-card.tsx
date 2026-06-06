'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Project = {
  id: string;
  title: string | null;
  thumbnail_url?: string | null;
  updated_at: string | null;
  raw_svg?: string | null;
  is_favorite?: boolean | null;
  team_id?: string | null;
};

type TeamOption = { id: string; name: string };

export function ProjectCard({
  project,
  variant = 'grid',
}: {
  project: Project;
  variant?: 'grid' | 'recent';
}) {
  const title = project.title ?? '제목 없음';
  const meta = formatRelativeTime(project.updated_at);

  // recent variant — 가로 스크롤 strip에서 사용하지만, 카드 폭을 아래 그리드 컬럼과 동일하게 맞춘다.
  // 그리드 gap=24px(gap-x-6) 기준으로 컬럼 수에 맞춰 (100% - 총 gap)/cols 로 계산.
  const wrapperClass =
    variant === 'recent'
      ? 'group relative block shrink-0 cursor-pointer w-[calc((100%-24px)/2)] sm:w-[calc((100%-48px)/3)] md:w-[calc((100%-72px)/4)] xl:w-[calc((100%-96px)/5)]'
      : 'group relative block cursor-pointer';

  // 캔버스 미리보기 우선순위:
  // 1) thumbnail_url(저장된 PNG/JPG가 있으면 그걸로) → 2) sketch.raw_svg(현재 캔버스 SVG)
  //   → 3) 기본 placeholder. raw_svg는 data URL로 인라인해 별도 fetch 없이 바로 그려준다.
  const svgDataUrl = project.raw_svg
    ? `data:image/svg+xml;utf8,${encodeURIComponent(project.raw_svg)}`
    : null;

  return (
    <div className={wrapperClass}>
      <Link href={`/projects/${project.id}`} className="block">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-white ring-1 ring-[#EAEAEA] transition-all group-hover:ring-[#1E1E1E]/30 group-hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
          {project.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={project.thumbnail_url}
              alt={title}
              className="h-full w-full object-cover"
            />
          ) : svgDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={svgDataUrl}
              alt={title}
              className="h-full w-full object-contain p-3"
            />
          ) : (
            <ThumbnailPlaceholder />
          )}
        </div>
        <div className="px-1 pt-3">
          <p className="truncate text-[13px] font-medium tracking-tight text-[#1E1E1E]">
            {title}
          </p>
          <p className="truncate pt-0.5 text-[11px] tracking-tight text-[#A3A3A3]">
            공유 안 함 · {meta}
          </p>
        </div>
      </Link>
      <FavoriteToggle projectId={project.id} initial={project.is_favorite ?? false} />
      <CardMenu
        projectId={project.id}
        title={title}
        currentTeamId={project.team_id ?? null}
      />
    </div>
  );
}

// 카드 우상단 hover 시 노출되는 케밥 메뉴. Link 아래에 절대배치되며, 이벤트 전파를 막아 클릭 시
// 프로젝트 진입(Link)이 아닌 메뉴 토글만 발동시킨다.
function CardMenu({
  projectId,
  title,
  currentTeamId,
}: {
  projectId: string;
  title: string;
  currentTeamId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [teams, setTeams] = useState<TeamOption[] | null>(null);
  const [teamSubmenuOpen, setTeamSubmenuOpen] = useState(false);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setTeamSubmenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setTeamSubmenuOpen(false);
      }
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 메뉴가 처음 열릴 때만 팀 목록을 가져온다.
  useEffect(() => {
    if (!open || teams !== null) return;
    fetch('/api/teams')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: { teams: TeamOption[] }) => setTeams(j.teams))
      .catch(() => setTeams([]));
  }, [open, teams]);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!confirm(`"${title}" 프로젝트를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ??
            `삭제 실패 (${res.status})`,
        );
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      console.error('[project delete]', err);
      alert(err instanceof Error ? err.message : '삭제 중 오류가 발생했습니다.');
      setBusy(false);
    }
  }

  async function moveToTeam(teamId: string | null) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ??
            `이동 실패 (${res.status})`,
        );
      }
      setOpen(false);
      setTeamSubmenuOpen(false);
      router.refresh();
    } catch (err) {
      console.error('[project move]', err);
      alert(err instanceof Error ? err.message : '이동 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={containerRef} className="absolute right-2 top-2 z-10">
      <button
        type="button"
        aria-label="프로젝트 메뉴"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={[
          'flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-[#525252] backdrop-blur-sm transition-opacity hover:bg-white hover:text-[#1E1E1E] ring-1 ring-[#EAEAEA]',
          open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
        ].join(' ')}
      >
        <KebabIcon className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-9 min-w-[180px] overflow-hidden rounded-md border border-[#EAEAEA] bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setTeamSubmenuOpen((v) => !v);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#1E1E1E] hover:bg-black/[0.04] disabled:opacity-60"
          >
            <FolderIcon className="h-3.5 w-3.5" />
            <span className="flex-1">팀으로 이동</span>
            <ChevronRightIcon className="h-3 w-3 text-[#A3A3A3]" />
          </button>
          {teamSubmenuOpen ? (
            <div className="border-t border-[#EAEAEA] bg-[#FAFAFA] py-1">
              {teams === null ? (
                <p className="px-3 py-1.5 text-[12px] text-[#A3A3A3]">불러오는 중…</p>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy || currentTeamId === null}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      moveToTeam(null);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[#525252] hover:bg-black/[0.04] disabled:opacity-50"
                  >
                    <span className="flex-1">개인 프로젝트</span>
                    {currentTeamId === null ? <CheckIcon className="h-3 w-3" /> : null}
                  </button>
                  {teams.length === 0 ? (
                    <p className="px-3 py-1.5 text-[12px] text-[#A3A3A3]">
                      가입한 팀이 없습니다.
                    </p>
                  ) : (
                    teams.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        disabled={busy || currentTeamId === t.id}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          moveToTeam(t.id);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[#525252] hover:bg-black/[0.04] disabled:opacity-50"
                      >
                        <span className="flex-1 truncate">{t.name}</span>
                        {currentTeamId === t.id ? <CheckIcon className="h-3 w-3" /> : null}
                      </button>
                    ))
                  )}
                </>
              )}
            </div>
          ) : null}
          <div className="my-1 h-px bg-[#EAEAEA]" />
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={handleDelete}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            <span>{busy ? '처리 중...' : '삭제'}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FolderIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
      <path
        d="M2 5a1.5 1.5 0 0 1 1.5-1.5h2.4a1 1 0 0 1 .8.4l.7.93a1 1 0 0 0 .8.4h4.3A1.5 1.5 0 0 1 14 6.73V11.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5V5Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="m6 4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" {...props}>
      <path d="m3.5 8.5 3 3 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 카드 좌상단 별 토글. 채워지면 즐겨찾기 상태. 낙관적 업데이트 후 PATCH, 실패 시 롤백.
function FavoriteToggle({
  projectId,
  initial,
}: {
  projectId: string;
  initial: boolean;
}) {
  const [fav, setFav] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const next = !fav;
    setFav(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_favorite: next }),
      });
      if (!res.ok) throw new Error(`즐겨찾기 변경 실패 (${res.status})`);
      router.refresh();
    } catch (err) {
      console.error('[project favorite]', err);
      setFav(!next); // 롤백
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      aria-label={fav ? '즐겨찾기 해제' : '즐겨찾기'}
      aria-pressed={fav}
      onClick={toggle}
      className={[
        'absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 backdrop-blur-sm ring-1 ring-[#EAEAEA] transition-opacity hover:bg-white',
        fav
          ? 'text-amber-400 opacity-100'
          : 'text-[#525252] opacity-0 hover:text-[#1E1E1E] group-hover:opacity-100 focus:opacity-100',
      ].join(' ')}
    >
      <StarIcon className="h-3.5 w-3.5" filled={fav} />
    </button>
  );
}

function StarIcon({ filled, ...props }: { filled?: boolean } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.4"
      {...props}
    >
      <path
        d="m8 2.5 1.7 3.45 3.8.55-2.75 2.68.65 3.8L8 11.2l-3.4 1.78.65-3.8L2.5 6.5l3.8-.55L8 2.5Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function KebabIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}>
      <circle cx="8" cy="3.5" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="8" cy="12.5" r="1.25" />
    </svg>
  );
}

function TrashIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
      <path
        d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThumbnailPlaceholder() {
  return <div className="h-full w-full bg-neutral-100" />;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '방금 전';
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHour < 24) return `${diffHour}시간 전`;
  if (diffDay < 7) return `${diffDay}일 전`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}주 전`;
  return date.toLocaleDateString('ko-KR');
}
