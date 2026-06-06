import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { HomeSidebar } from '@/app/_components/home-sidebar';
import { HomeTopbar } from '@/app/_components/home-topbar';
import { ProjectCard } from '@/app/_components/project-card';
import { TeamHeader } from './_components/team-header';
import { MembersSection } from './_components/members-section';
import { InvitationsSection } from './_components/invitations-section';
import { LibrarySection } from './_components/library-section';
import { getTeamRole, roleAtLeast } from '@/lib/api/teams';

export const dynamic = 'force-dynamic';

type Member = {
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  email: string | null;
  created_at: string;
};

type Invitation = {
  id: string;
  email: string;
  role: 'admin' | 'member';
  status: string;
  created_at: string;
  expires_at: string;
};

export default async function TeamPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) notFound();

  const role = await getTeamRole(supabase, params.id, user.id);
  if (!role) notFound();

  const { data: team } = await supabase
    .from('teams')
    .select('id, name, created_at, updated_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!team) notFound();

  // 사이드바용 팀 목록(현재 페이지의 팀 강조는 별도 처리하지 않음 — 사이드바는 view 만 active 추적).
  const { data: teamRows } = await supabase
    .from('team_members')
    .select('role, team:teams(id, name)')
    .eq('user_id', user.id);
  const teamsForSidebar =
    (teamRows ?? [])
      .filter((row) => row.team)
      .map((row) => {
        const t = row.team as unknown as { id: string; name: string };
        return { id: t.id, name: t.name, role: row.role as string };
      });

  // 멤버 로드 (이메일은 admin.auth.admin.getUserById 보강).
  const admin = createAdminClient();
  const { data: rawMembers } = await supabase
    .from('team_members')
    .select('user_id, role, created_at')
    .eq('team_id', params.id)
    .order('created_at', { ascending: true });
  const members: Member[] = await Promise.all(
    (rawMembers ?? []).map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      return {
        user_id: m.user_id,
        role: m.role as Member['role'],
        email: data.user?.email ?? null,
        created_at: m.created_at,
      };
    }),
  );

  // 대기 중 초대 (admin 이상만 RLS 로 조회 가능).
  let invitations: Invitation[] = [];
  if (roleAtLeast(role, 'admin')) {
    const { data: inv } = await supabase
      .from('team_invitations')
      .select('id, email, role, status, created_at, expires_at')
      .eq('team_id', params.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    invitations = (inv ?? []) as Invitation[];
  }

  // 팀 프로젝트.
  const { data: teamProjectRows } = await supabase
    .from('projects')
    .select(
      'id, title, thumbnail_url, is_favorite, team_id, updated_at, raw_svg:sketch->>raw_svg',
    )
    .eq('team_id', params.id)
    .order('updated_at', { ascending: false })
    .limit(200);
  const teamProjects = teamProjectRows ?? [];
  // 사이드바 검색 드롭다운용 — 이 팀의 프로젝트만. "모든 결과 보기"는 /?q= 로 전체 검색을 연다.
  const searchProjects = teamProjects.map((p) => ({
    id: p.id,
    title: p.title,
    updated_at: p.updated_at,
    teamName: team.name,
  }));

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-[#1E1E1E]">
      <HomeSidebar
        user={{
          id: user.id,
          email: user.email ?? null,
          displayName: null,
          avatarUrl: null,
          role: null,
        }}
        teams={teamsForSidebar}
        projects={searchProjects}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <HomeTopbar />

        <main className="scrollbar-minimal min-w-0 flex-1 overflow-auto bg-white">
          <div className="mx-auto max-w-[1680px] px-12 py-10 space-y-12">
            <TeamHeader
              team={{ id: team.id, name: team.name }}
              role={role}
              memberCount={members.length}
            />

            <MembersSection
              teamId={team.id}
              currentUserId={user.id}
              currentRole={role}
              members={members}
            />

            {roleAtLeast(role, 'admin') ? (
              <InvitationsSection teamId={team.id} initialInvitations={invitations} />
            ) : null}

            <LibrarySection teamId={team.id} />

            <section className="space-y-5">
              <h2 className="text-[15px] font-medium tracking-tight text-[#1E1E1E]">
                팀 프로젝트
              </h2>
              {teamProjects.length === 0 ? (
                <p className="py-12 text-center text-[13px] tracking-tight text-[#A3A3A3]">
                  아직 팀에 속한 프로젝트가 없습니다. 프로젝트 카드의 메뉴에서 “팀으로 이동”을 선택해 보내세요.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {teamProjects.map((p) => (
                    <ProjectCard key={p.id} project={p} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
