import { createClient } from '@/lib/supabase/server';
import { HomeSidebar } from './_components/home-sidebar';
import { HomeTopbar } from './_components/home-topbar';
import { ProjectCard } from './_components/project-card';
import { NewProjectCard } from './_components/new-project-card';
import { LandingPage } from './_components/landing-page';
import { SortMenu, type SortKey, type SortOrder } from './_components/sort-menu';

export const dynamic = 'force-dynamic';

interface Project {
  id: string;
  title: string | null;
  thumbnail_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  raw_svg?: string | null;
  is_favorite?: boolean | null;
  team_id?: string | null;
}

type HomeView = 'home' | 'recent' | 'projects' | 'favorites';

const VALID_VIEWS: HomeView[] = ['home', 'recent', 'projects', 'favorites'];
const VALID_SORTS: SortKey[] = ['alpha', 'created', 'updated'];
const VALID_ORDERS: SortOrder[] = ['asc', 'desc'];

// 선택된 기준/순서대로 프로젝트 목록을 정렬한다. DB는 updated_at desc로 한 번만 읽고
// 클라이언트 정렬 메뉴 선택은 여기서 in-memory로 반영한다(목록 규모가 작아 충분).
function sortProjects(
  list: Project[],
  sort: SortKey,
  order: SortOrder,
): Project[] {
  const dir = order === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    if (sort === 'alpha') {
      const at = a.title?.trim() || '제목 없음';
      const bt = b.title?.trim() || '제목 없음';
      return at.localeCompare(bt, 'ko') * dir;
    }
    const key = sort === 'created' ? 'created_at' : 'updated_at';
    const at = a[key] ? new Date(a[key] as string).getTime() : 0;
    const bt = b[key] ? new Date(b[key] as string).getTime() : 0;
    return (at - bt) * dir;
  });
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: { view?: string; sort?: string; order?: string; q?: string };
}) {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  // 비로그인 상태: 풀 마케팅 랜딩. CTA → /login → 다시 / 로 리다이렉트되어 프로젝트 그리드로 진입.
  if (!user) {
    return <LandingPage />;
  }

  // ?view= 가 없으면 '홈' 대시보드(최근 사용 strip + 내 프로젝트 그리드)를 기본 랜딩으로.
  const view: HomeView = VALID_VIEWS.includes(searchParams.view as HomeView)
    ? (searchParams.view as HomeView)
    : 'home';
  const sort: SortKey = VALID_SORTS.includes(searchParams.sort as SortKey)
    ? (searchParams.sort as SortKey)
    : 'updated';
  const order: SortOrder = VALID_ORDERS.includes(searchParams.order as SortOrder)
    ? (searchParams.order as SortOrder)
    : 'desc';

  // 사이드바 프로필 메뉴에 표시할 정보. profiles 우선, 없으면 Google OAuth 메타데이터로 보강.
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url, role')
    .eq('id', user.id)
    .maybeSingle();
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName =
    profile?.display_name ??
    (typeof meta.full_name === 'string' ? meta.full_name : null) ??
    (typeof meta.name === 'string' ? meta.name : null) ??
    null;
  const avatarUrl =
    profile?.avatar_url ??
    (typeof meta.avatar_url === 'string' ? meta.avatar_url : null) ??
    (typeof meta.picture === 'string' ? meta.picture : null) ??
    null;
  const role = profile?.role ?? null;

  // 프로젝트 목록 (최신순). 한 번 읽어 뷰별로 클라이언트 분류 없이 서버에서 분기한다.
  // sketch.raw_svg를 함께 가져와 카드 미리보기에 캔버스 SVG를 렌더 — thumbnail_url이 없거나
  // 동일한 default 이미지로 떨어지는 케이스를 실제 캔버스 모양으로 대체한다.
  const { data: rows } = await supabase
    .from('projects')
    .select(
      'id, title, thumbnail_url, is_favorite, team_id, created_at, updated_at, raw_svg:sketch->>raw_svg',
    )
    .order('updated_at', { ascending: false })
    .limit(200);
  // 사이드바 "팀" 섹션에 표시할 팀 목록.
  const { data: teamRows } = await supabase
    .from('team_members')
    .select('role, team:teams(id, name)')
    .eq('user_id', user.id);
  const teams =
    (teamRows ?? [])
      .filter((row) => row.team)
      .map((row) => {
        // supabase-js 가 1:N 관계와 1:1 을 추론에서 구분 못해 row.team 타입이 모호하다.
        // 우리는 team_id 가 NOT NULL FK 이므로 단일 객체임을 알고 있다.
        const t = row.team as unknown as { id: string; name: string };
        return { id: t.id, name: t.name, role: row.role as string };
      }) ?? [];

  const allProjects: Project[] = rows ?? [];
  // 사이드바 검색 드롭다운에 넘길 목록 — 팀 프로젝트는 팀 이름, 개인 프로젝트는 null.
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
  const searchProjects = allProjects.map((p) => ({
    id: p.id,
    title: p.title,
    updated_at: p.updated_at,
    teamName: p.team_id ? teamNameById.get(p.team_id) ?? '팀 프로젝트' : null,
  }));
  // "모든 결과 보기"(/?q=...) — 제목으로 전체 프로젝트(개인+팀)를 필터링한 결과 그리드.
  const query = typeof searchParams.q === 'string' ? searchParams.q.trim() : '';
  const searchResults = query
    ? sortProjects(
        allProjects.filter((p) =>
          (p.title ?? '제목 없음').toLowerCase().includes(query.toLowerCase()),
        ),
        sort,
        order,
      )
    : [];
  // 홈은 "개인 프로젝트" 영역. 팀 프로젝트는 /teams/[id] 페이지에서 본다.
  // 즐겨찾기 뷰만 예외적으로 팀 프로젝트도 함께 보여준다(어디서든 즐겨찾기에서 찾을 수 있게).
  const personal = allProjects.filter((p) => p.team_id == null);
  // "최근에 사용한 항목"은 정렬 메뉴와 무관하게 항상 마지막 수정순. 홈 대시보드는 가로 스크롤 5개,
  // 최근 항목 전용 뷰는 그리드 8개를 보여준다.
  const recent = personal.slice(0, 5);
  const recentEight = personal.slice(0, 8);
  // 그리드 목록은 선택된 정렬 기준/순서를 반영한다.
  const projects = sortProjects(personal, sort, order);
  const favorites = sortProjects(
    allProjects.filter((p) => p.is_favorite),
    sort,
    order,
  );

  const topbarTitle = query
    ? '검색 결과'
    : view === 'home'
      ? '최근에 사용한 항목'
      : view === 'recent'
        ? '최근 항목'
        : view === 'projects'
          ? '내 프로젝트'
          : '즐겨찾기';

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-[#1E1E1E]">
      <HomeSidebar
        user={{
          id: user.id,
          email: user.email ?? null,
          displayName,
          avatarUrl,
          role,
        }}
        view={view}
        teams={teams}
        projects={searchProjects}
        searchQuery={query}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <HomeTopbar title={topbarTitle} />

        <main className="scrollbar-minimal min-w-0 flex-1 overflow-auto bg-white">
          <div className="mx-auto max-w-[1680px] px-9 pb-10 pt-4">
            {query ? (
              // 검색 결과 — 제목에 검색어를 포함하는 전체 프로젝트(개인+팀) 그리드.
              <section className="space-y-6">
                <h2 className="text-[15px] tracking-tight text-[#525252]">
                  <span className="font-medium text-[#1E1E1E]">‘{query}’</span> 검색 결과{' '}
                  <span className="text-[#A3A3A3]">({searchResults.length})</span>
                </h2>
                {searchResults.length === 0 ? (
                  <p className="py-16 text-center text-[13px] tracking-tight text-[#A3A3A3]">
                    ‘{query}’에 대한 프로젝트를 찾지 못했습니다.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                    {searchResults.map((p) => (
                      <ProjectCard key={p.id} project={p} />
                    ))}
                  </div>
                )}
              </section>
            ) : view === 'home' ? (
              <>
                {/* 홈 대시보드 — 최근 사용 가로 스크롤 + 내 프로젝트 그리드 2개 서브섹션.
                    섹션 타이틀("최근에 사용한 항목")은 상단바 타이틀이 대신하므로 본문에서는 생략. */}
                <section>
                  {/* gap·카드 폭을 아래 '내 프로젝트' 그리드와 동일하게 맞춰 컬럼 정렬을 일치시킨다. */}
                  <div className="scrollbar-minimal -mx-1 flex gap-6 overflow-x-auto px-1 py-3">
                    {recent.map((p) => (
                      <ProjectCard key={p.id} project={p} variant="recent" />
                    ))}
                  </div>
                </section>

                <div className="my-12 h-px w-full bg-[#EAEAEA]" />

                <ProjectSection
                  title="내 프로젝트"
                  projects={projects}
                  sort={sort}
                  order={order}
                  showNewCard
                />
              </>
            ) : view === 'recent' ? (
              // 최근 항목 — 마지막 수정순 상위 8개. ProjectSection은 전달 순서를 그대로 렌더하므로
              // recentEight(최근순)를 넘겨 순서는 유지하고, 다른 뷰와 동일한 정렬 컨트롤 행으로
              // 그리드 시작 위치를 맞춘다.
              <ProjectSection
                title="최근 항목"
                projects={recentEight}
                sort={sort}
                order={order}
                hideTitle
                emptyMessage="최근에 사용한 프로젝트가 없습니다."
              />
            ) : view === 'projects' ? (
              <ProjectSection
                title="내 프로젝트"
                projects={projects}
                sort={sort}
                order={order}
                showNewCard
                hideTitle
              />
            ) : (
              <ProjectSection
                title="즐겨찾기"
                projects={favorites}
                sort={sort}
                order={order}
                emptyMessage="아직 즐겨찾기한 프로젝트가 없습니다. 프로젝트 카드의 별 아이콘을 눌러 추가하세요."
                hideTitle
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// 프로젝트 그리드 섹션. 헤더 컨트롤(정렬/필터/보기 전환)은 현재 표시만 한다.
// hideTitle=true 면 상단 바가 타이틀을 대신 렌더 — 섹션 자체는 컨트롤만 우측 정렬해 노출한다.
function ProjectSection({
  title,
  projects,
  sort,
  order,
  showNewCard = false,
  emptyMessage,
  hideTitle = false,
}: {
  title: string;
  projects: Project[];
  sort: SortKey;
  order: SortOrder;
  showNewCard?: boolean;
  emptyMessage?: string;
  hideTitle?: boolean;
}) {
  const isEmpty = projects.length === 0;

  return (
    <section className="space-y-6">
      <div
        className={`flex items-center ${hideTitle ? 'justify-end' : 'justify-between'}`}
      >
        {hideTitle ? null : (
          <h2 className="text-[15px] font-medium tracking-tight text-[#1E1E1E]">
            {title}
          </h2>
        )}
        <div className="flex items-center gap-2 text-[12px] tracking-tight text-[#525252]">
          <SortMenu sort={sort} order={order} />
          <button
            type="button"
            aria-label="필터"
            className="rounded-md p-1.5 hover:bg-black/[0.04] hover:text-[#1E1E1E]"
          >
            <FilterIcon className="h-3.5 w-3.5" />
          </button>
          <div className="ml-1 flex items-center rounded-md border border-[#EAEAEA] p-0.5">
            <button
              type="button"
              aria-label="그리드 보기"
              className="rounded-sm bg-black/[0.06] p-1 text-[#1E1E1E]"
            >
              <GridSmallIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="리스트 보기"
              className="rounded-sm p-1 text-[#A3A3A3] hover:text-[#1E1E1E]"
            >
              <ListIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {isEmpty && !showNewCard ? (
        <p className="py-16 text-center text-[13px] tracking-tight text-[#A3A3A3]">
          {emptyMessage ?? '프로젝트가 없습니다.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {showNewCard ? <NewProjectCard /> : null}
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function FilterIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M2.5 4h11M4.5 8h7M6.5 12h3" strokeLinecap="round" />
    </svg>
  );
}

function GridSmallIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.6" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="0.6" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="0.6" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="0.6" />
    </svg>
  );
}

function ListIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" strokeLinecap="round" />
    </svg>
  );
}
