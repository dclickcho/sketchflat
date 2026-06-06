import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { EditorShell } from './_components/editor-shell';

// Next.js 14 — params는 동기 객체.
export default async function ProjectEditorPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();

  // 인증 확인 — 미인증이면 /login으로 redirect.
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    redirect('/login');
  }

  // Supabase 직접 조회 (RLS가 본인 row만 반환하므로 별도 소유권 체크 불필요).
  const { data: project, error } = await supabase
    .from('projects')
    .select('id, title, sketch')
    .eq('id', params.id)
    .maybeSingle();

  if (error || !project) {
    notFound();
  }

  // 프로필 동그라미에 표시할 한 글자 — 이메일 로컬파트 첫글자(영문은 대문자).
  const rawInitial = (authData.user.email ?? authData.user.id ?? 'U').trim()[0] ?? 'U';
  const userInitial = /[a-z]/.test(rawInitial) ? rawInitial.toUpperCase() : rawInitial;

  return (
    <EditorShell
      projectId={project.id}
      initialTitle={project.title ?? '제목 없음'}
      userInitial={userInitial}
    />
  );
}
