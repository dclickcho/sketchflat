import { createClient } from '@/lib/supabase/client';

// 사전 제작 라이브러리 카탈로그 한 행 — UI 가 카드로 그릴 때 필요한 최소 정보.
// svgUrl 은 library-assets 공개 버킷의 storage_path 를 풀어 만든 절대 URL.
// library_assets 테이블/버킷 모두 공개 read RLS 라 anon 키로 직접 조회한다.
export interface LibraryCatalogEntry {
  id: string;
  name: string;
  category: string;
  svgUrl: string;
}

export async function fetchLibraryCatalog(): Promise<LibraryCatalogEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('library_assets')
    .select('id, name, category, storage_path')
    .order('category', { ascending: true })
    .order('id', { ascending: true });

  if (error || !data) return [];

  return data.map((row) => {
    const { data: pub } = supabase.storage
      .from('library-assets')
      .getPublicUrl(row.storage_path);
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      svgUrl: pub.publicUrl,
    };
  });
}
