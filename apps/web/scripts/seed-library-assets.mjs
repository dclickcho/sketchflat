// 사전 제작 라이브러리 SVG 를 Supabase Storage 의 library-assets 버킷에 업로드.
// 마이그레이션이 적용되어 (1) library_assets 테이블에 행이 시드되어 있고 (2) library-assets
// 공개 버킷이 만들어진 상태에서 한 번 실행하면 된다.
//
// 사용법 (apps/web 기준):
//   pnpm dlx dotenv-cli -e ../../.env.local -- node scripts/seed-library-assets.mjs
// 또는 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 를 환경변수로 직접 export 한 뒤
//   node scripts/seed-library-assets.mjs
//
// repo 루트의 'round collar.svg' 를 library-assets/collar/round.svg 로 업로드.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL (또는 SUPABASE_URL) 와 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.',
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// repoRoot/<file> → bucket/<storagePath>
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

const ASSETS = [
  {
    file: 'round collar.svg',
    storagePath: 'collar/round.svg',
  },
  {
    file: 'puff sleeve.svg',
    storagePath: 'sleeve/puff.svg',
  },
];

const BUCKET = 'library-assets';

for (const asset of ASSETS) {
  const localPath = path.join(REPO_ROOT, asset.file);
  if (!fs.existsSync(localPath)) {
    console.warn(`skip — 파일 없음: ${localPath}`);
    continue;
  }
  const body = fs.readFileSync(localPath);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(asset.storagePath, body, {
      contentType: 'image/svg+xml',
      upsert: true,
    });
  if (error) {
    console.error(`업로드 실패 (${asset.storagePath}):`, error.message);
    process.exit(1);
  }
  console.log(`업로드 완료: ${BUCKET}/${asset.storagePath}`);
}

console.log('done.');
