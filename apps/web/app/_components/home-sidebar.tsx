'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CreateTeamModal } from './create-team-modal';
import { NotificationsMenu } from './notifications-menu';
import { ProfileMenu, type ProfileUser } from './profile-menu';
import { ProjectSearch, type SearchProject } from './project-search';

type SidebarUser = ProfileUser;

type SidebarTeam = { id: string; name: string; role: string };

type HomeView = 'home' | 'recent' | 'projects' | 'favorites';

// view 가 있는 항목은 /?view=... 로 라우팅된다. href 가 없는 항목(템플릿/휴지통)은
// 아직 미구현이라 비활성 버튼으로 둔다.
const navItems: {
  label: string;
  icon: (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element;
  view?: HomeView;
}[] = [
  // '최근 항목'을 홈 대시보드(최근 사용 strip + 내 프로젝트 그리드)로 연결한다.
  // 사용자 멘탈모델: 홈 화면 == 최근 항목.
  { label: '최근 항목', icon: ClockIcon, view: 'home' },
  { label: '내 프로젝트', icon: FolderIcon, view: 'projects' },
  { label: '즐겨찾기', icon: StarIcon, view: 'favorites' },
  { label: '템플릿', icon: GridIcon },
  { label: '휴지통', icon: TrashIcon },
];

export function HomeSidebar({
  user,
  view = 'home',
  teams = [],
  projects = [],
  searchQuery = '',
}: {
  user: SidebarUser;
  view?: HomeView;
  teams?: SidebarTeam[];
  projects?: SearchProject[];
  searchQuery?: string;
}) {
  const [createTeamOpen, setCreateTeamOpen] = useState(false);

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-[#EAEAEA] bg-white text-[#1E1E1E]">
      {/* 상단 행 — 좌측 프로필, 우측 알림 벨. 아바타 좌측 끝을 아래 nav 아이콘과 정렬한다. */}
      <div className="flex h-12 items-center gap-1 px-2">
        <ProfileMenu user={user} />
        <NotificationsMenu />
      </div>

      {/* 검색 — outer px-2, inner px-3으로 nav 버튼과 좌측 정렬 일치. */}
      <div className="px-2 pt-1">
        <ProjectSearch projects={projects} initialQuery={searchQuery} />
      </div>

      {/* 네비게이션 */}
      <nav className="px-2 pt-3">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const active = item.view != null && item.view === view;
            const className = `flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] tracking-tight transition-colors ${
              active
                ? 'bg-black/[0.06] text-[#1E1E1E]'
                : 'text-[#525252] hover:bg-black/[0.04] hover:text-[#1E1E1E]'
            }`;
            return (
              <li key={item.label}>
                {item.view ? (
                  <Link href={`/?view=${item.view}`} className={className}>
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                ) : (
                  <button type="button" className={className}>
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 팀 섹션 */}
      <div className="mt-6 px-2">
        <div className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[#A3A3A3]">
          팀
        </div>
        {teams.length > 0 ? (
          <ul className="space-y-0.5 pb-1">
            {teams.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/teams/${t.id}`}
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] tracking-tight text-[#525252] hover:bg-black/[0.04] hover:text-[#1E1E1E]"
                >
                  <UsersIcon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <button
          type="button"
          onClick={() => setCreateTeamOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] tracking-tight text-[#525252] hover:bg-black/[0.04] hover:text-[#1E1E1E]"
        >
          <PlusIcon className="h-4 w-4 shrink-0" />
          <span>새 팀 만들기</span>
        </button>
      </div>

      <CreateTeamModal open={createTeamOpen} onClose={() => setCreateTeamOpen(false)} />
    </aside>
  );
}

function UsersIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
      <circle cx="6" cy="6" r="2.4" />
      <path d="M2 13c0-2 1.8-3.5 4-3.5s4 1.5 4 3.5" strokeLinecap="round" />
      <path d="M10.5 5a2.2 2.2 0 0 1 0 4.4M11 9.5c1.7.4 2.7 1.6 2.7 3" strokeLinecap="round" />
    </svg>
  );
}

/* ─────────────── 아이콘 (인라인 SVG, 의존성 없이) ─────────────── */
function ClockIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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

function StarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
      <path
        d="m8 2.5 1.7 3.45 3.8.55-2.75 2.68.65 3.8L8 11.2l-3.4 1.78.65-3.8L2.5 6.5l3.8-.55L8 2.5Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GridIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.8" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="0.8" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="0.8" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="0.8" />
    </svg>
  );
}

function TrashIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
      <path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" />
    </svg>
  );
}


