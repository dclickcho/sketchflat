import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// service-role 키는 RLS를 우회. 서버 전용. 클라이언트 번들에 절대 포함되면 안 됨.
// 사용처: Replicate webhook 콜백 등 사용자 세션 없이 DB 쓰기가 필요한 라우트.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
