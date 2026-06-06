import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ApiSandbox } from '../_components/api-sandbox';

export const dynamic = 'force-dynamic';

// 개발용 API 검증 페이지. 홈 화면에서 분리되어 라이트 테마 랜딩에 영향 없음.
export default async function DebugPage() {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">API 검증</h1>
          <p className="text-sm text-muted-foreground">개발용 디버그 페이지</p>
        </div>
        <Link
          href="/"
          className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
        >
          홈으로
        </Link>
      </header>
      <ApiSandbox />
    </main>
  );
}
