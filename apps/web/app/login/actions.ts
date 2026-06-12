'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const CredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(72),
});

// 열린 리다이렉트 방지: 같은 사이트 안의 절대 경로(`/...`)만 허용한다.
// `//example.com` 같은 프로토콜 상대 URL 도 차단.
function safeNext(input: FormDataEntryValue | null): string {
  if (typeof input !== 'string') return '/';
  if (!input.startsWith('/')) return '/';
  if (input.startsWith('//')) return '/';
  return input;
}

function backToLogin(mode: 'login' | 'signup', message: string): never {
  const params = new URLSearchParams({ mode, error: message });
  redirect(`/login?${params.toString()}`);
}

export async function login(formData: FormData) {
  const parsed = CredentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) backToLogin('login', '이메일/비밀번호 형식이 올바르지 않습니다.');

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // 이메일/비밀번호 불일치만 사용자 친화적 문구로 치환. 그 외(미확인 메일,
    // rate limit 등)는 Supabase 원문을 그대로 노출해 원인 파악을 돕는다.
    const wrongCreds =
      error.code === 'invalid_credentials' ||
      /invalid login credentials/i.test(error.message);
    backToLogin(
      'login',
      wrongCreds
        ? 'That email and password combination is incorrect.'
        : error.message,
    );
  }

  const next = safeNext(formData.get('next'));
  revalidatePath('/', 'layout');
  redirect(next);
}

export async function signup(formData: FormData) {
  const parsed = CredentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) backToLogin('signup', '이메일/비밀번호 형식이 올바르지 않습니다.');

  const supabase = createClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) backToLogin('signup', error.message);

  // 이메일 확인 ON: session=null. 확인 메일 안내 페이지로.
  if (!data.session) {
    redirect('/login?mode=login&info=' + encodeURIComponent('확인 메일을 보냈습니다. 메일함을 확인하세요.'));
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function logout() {
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

export async function loginWithGoogle() {
  const supabase = createClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error) backToLogin('login', error.message);
  if (data.url) redirect(data.url);
  backToLogin('login', 'Google 로그인을 시작할 수 없습니다.');
}
