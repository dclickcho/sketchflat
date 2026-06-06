import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { AcceptForm } from './_components/accept-form';

export const dynamic = 'force-dynamic';

// 초대 수락 페이지. 토큰을 admin 클라이언트로 조회해 메타를 보여주고
// (만료/이미 처리/이메일 불일치) 정상 상태일 때 수락 버튼을 띄운다.
// 미로그인은 /login?next=현재경로 로 보낸다.
export default async function InvitePage({
  params,
}: {
  params: { token: string };
}) {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/teams/invite/${params.token}`)}`);
  }

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from('team_invitations')
    .select('id, email, role, status, expires_at, team:teams(id, name)')
    .eq('token', params.token)
    .maybeSingle();

  const teamName = (inv?.team as { name?: string } | null)?.name ?? null;
  const expired = inv ? new Date(inv.expires_at).getTime() < Date.now() : false;
  const emailMatches =
    !!inv && (user.email ?? '').toLowerCase() === inv.email.toLowerCase();

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-[#FAFAF8] p-6">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-[#EAEAEA]">
        <h1 className="text-[20px] font-semibold tracking-tight text-[#1E1E1E]">
          팀 초대
        </h1>
        {!inv ? (
          <p className="mt-3 text-[13px] tracking-tight text-[#525252]">
            존재하지 않는 초대입니다. 링크를 다시 확인해주세요.
          </p>
        ) : inv.status !== 'pending' ? (
          <p className="mt-3 text-[13px] tracking-tight text-[#525252]">
            이미 처리된 초대입니다 ({inv.status === 'accepted' ? '수락됨' : '철회됨'}).
          </p>
        ) : expired ? (
          <p className="mt-3 text-[13px] tracking-tight text-[#525252]">
            만료된 초대입니다. 팀 관리자에게 새로운 초대를 요청하세요.
          </p>
        ) : !emailMatches ? (
          <div className="mt-3 space-y-2 text-[13px] tracking-tight text-[#525252]">
            <p>
              이 초대는 <strong>{inv.email}</strong> 로 발송되었습니다. 현재{' '}
              <strong>{user.email}</strong> 로 로그인되어 있어 수락할 수 없습니다.
            </p>
            <p>초대받은 이메일로 다시 로그인해주세요.</p>
          </div>
        ) : (
          <>
            <p className="mt-3 text-[13px] tracking-tight text-[#525252]">
              <strong>{teamName ?? '팀'}</strong> 에 {inv.role === 'admin' ? '관리자' : '멤버'}로 합류하시겠어요?
            </p>
            <AcceptForm token={params.token} />
          </>
        )}
      </div>
    </div>
  );
}
