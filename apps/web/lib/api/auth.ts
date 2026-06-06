import 'server-only';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { unauthorized } from './errors';

type AuthResult =
  | { ok: true; user: User; supabase: ReturnType<typeof createClient> }
  | { ok: false; response: Response };

// API route 진입점에서 호출. 미인증이면 401 응답을 곧장 반환할 수 있게 Response를 돌려준다.
//
//   const auth = await requireUser();
//   if (!auth.ok) return auth.response;
//   const { user, supabase } = auth;
export async function requireUser(): Promise<AuthResult> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { ok: false, response: unauthorized() };
  }
  return { ok: true, user: data.user, supabase };
}
