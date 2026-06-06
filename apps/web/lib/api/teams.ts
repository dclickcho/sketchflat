// 이 모듈은 서버 전용 의존성이 없고 순수 헬퍼만 가지므로 클라이언트에서도 import 가능
// (TeamRole 타입과 roleAtLeast 는 팀 페이지의 클라이언트 컴포넌트에서 사용).
import type { SupabaseClient } from '@supabase/supabase-js';

export type TeamRole = 'owner' | 'admin' | 'member';

// 역할 우선순위: owner > admin > member. 권한 비교에 사용.
const RANK: Record<TeamRole, number> = { owner: 3, admin: 2, member: 1 };

export function roleAtLeast(role: TeamRole, min: TeamRole): boolean {
  return RANK[role] >= RANK[min];
}

// 현재 사용자의 팀 내 역할을 조회한다. 멤버가 아니면 null.
// 사용자 세션 클라이언트로 호출하면 RLS(team_members_select_member) 하에서
// 본인 행은 같은 팀 멤버 조회 정책으로 읽을 수 있다.
export async function getTeamRole(
  supabase: SupabaseClient,
  teamId: string,
  userId: string,
): Promise<TeamRole | null> {
  const { data } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data?.role as TeamRole | undefined) ?? null;
}
