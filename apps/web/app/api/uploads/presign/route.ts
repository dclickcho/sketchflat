import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/auth';
import { badRequest, serverError, zodErrorResponse } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PresignSchema = z.object({
  // 사용자가 보낸 원본 파일명 — 확장자 추출에만 사용. 경로에는 직접 들어가지 않음.
  filename: z.string().min(1).max(255),
  // 'image/jpeg' 등. 클라이언트 업로드 시 Content-Type 헤더로 사용.
  content_type: z.string().min(1).max(100).optional(),
});

const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);

function safeExtension(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!m) return 'bin';
  const ext = m[1];
  return ALLOWED_EXT.has(ext) ? ext : 'bin';
}

// POST /api/uploads/presign — uploads 버킷에 직접 업로드하기 위한 signed URL 발급.
// 경로는 항상 '<user_id>/<uuid>.<ext>' — RLS 정책이 본인 폴더만 허용함.
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  let parsed;
  try {
    const json = await request.json().catch(() => ({}));
    parsed = PresignSchema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) return zodErrorResponse(err);
    return badRequest('JSON 파싱 실패');
  }

  const ext = safeExtension(parsed.filename);
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

  const { data, error } = await supabase.storage
    .from('uploads')
    .createSignedUploadUrl(path);

  if (error || !data) return serverError(error?.message ?? 'presign 실패');

  return NextResponse.json({
    bucket: 'uploads',
    path: data.path,
    token: data.token,
    signed_url: data.signedUrl,
    content_type: parsed.content_type ?? null,
  });
}
