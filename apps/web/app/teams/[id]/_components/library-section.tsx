'use client';

import { useEffect, useState } from 'react';

type Asset = {
  id: string;
  name: string;
  category: string;
  storage_path: string;
  created_at: string;
  url: string | null;
};

// 팀 라이브러리 패널. SVG 파일을 업로드하고 멤버들에게 공유한다.
// 업로드는 file.text() 로 SVG 마크업을 추출해 POST /api/teams/[id]/library 본문에 담아 보낸다.
export function LibrarySection({ teamId }: { teamId: string }) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Collar');
  const [file, setFile] = useState<File | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/teams/${teamId}/library`);
      if (!res.ok) throw new Error(`목록 로드 실패 (${res.status})`);
      const body = (await res.json()) as { assets: Asset[] };
      setAssets(body.assets);
    } catch (err) {
      setError(err instanceof Error ? err.message : '실패');
      setAssets([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('SVG 파일을 선택하세요.');
      return;
    }
    if (!name.trim()) {
      setError('이름을 입력하세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const svg = await file.text();
      if (!svg.includes('<svg')) throw new Error('올바른 SVG 파일이 아닙니다.');
      const res = await fetch(`/api/teams/${teamId}/library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), category: category.trim() || 'Other', svg }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ?? '업로드 실패',
        );
      }
      const newAsset = (body as { asset: Asset }).asset;
      setAssets((a) => [newAsset, ...(a ?? [])]);
      setName('');
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '업로드 실패');
    } finally {
      setBusy(false);
    }
  }

  async function remove(assetId: string) {
    if (!confirm('이 에셋을 삭제할까요?')) return;
    try {
      const res = await fetch(`/api/teams/${teamId}/library/${assetId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('삭제 실패');
      setAssets((a) => (a ?? []).filter((x) => x.id !== assetId));
    } catch (err) {
      alert(err instanceof Error ? err.message : '실패');
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-[15px] font-medium tracking-tight text-[#1E1E1E]">팀 라이브러리</h2>

      <form
        onSubmit={upload}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-[#EAEAEA] p-4"
      >
        <div className="min-w-[160px] flex-1">
          <label className="block text-[12px] tracking-tight text-[#525252]">이름</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            placeholder="예: Round Collar"
            className="mt-1 w-full rounded-md border border-[#EAEAEA] px-3 py-2 text-[13px] tracking-tight text-[#1E1E1E] focus:border-[#1E1E1E]/40 focus:outline-none disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-[12px] tracking-tight text-[#525252]">카테고리</label>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={busy}
            placeholder="Collar"
            className="mt-1 w-[160px] rounded-md border border-[#EAEAEA] px-3 py-2 text-[13px] tracking-tight text-[#1E1E1E] focus:border-[#1E1E1E]/40 focus:outline-none disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-[12px] tracking-tight text-[#525252]">SVG 파일</label>
          <input
            type="file"
            accept=".svg,image/svg+xml"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
            className="mt-1 block text-[12px] text-[#525252] file:mr-2 file:rounded-md file:border file:border-[#EAEAEA] file:bg-white file:px-2.5 file:py-1.5 file:text-[12px] file:text-[#1E1E1E] file:hover:bg-black/[0.04]"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-[#1E1E1E] px-3 py-2 text-[13px] font-medium tracking-tight text-white hover:bg-black disabled:opacity-60"
        >
          {busy ? '업로드 중…' : '에셋 추가'}
        </button>
      </form>

      {error ? <p className="text-[12px] text-red-600">{error}</p> : null}

      {assets === null ? (
        <p className="py-8 text-center text-[13px] tracking-tight text-[#A3A3A3]">
          불러오는 중…
        </p>
      ) : assets.length === 0 ? (
        <p className="py-12 text-center text-[13px] tracking-tight text-[#A3A3A3]">
          아직 라이브러리에 에셋이 없습니다.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {assets.map((a) => (
            <div
              key={a.id}
              className="group relative overflow-hidden rounded-lg border border-[#EAEAEA] bg-white"
            >
              <div className="aspect-square w-full bg-white p-3">
                {a.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.url}
                    alt={a.name}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="h-full w-full bg-neutral-100" />
                )}
              </div>
              <div className="border-t border-[#EAEAEA] px-3 py-2">
                <p className="truncate text-[12px] font-medium tracking-tight text-[#1E1E1E]">
                  {a.name}
                </p>
                <p className="truncate text-[11px] tracking-tight text-[#A3A3A3]">
                  {a.category}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(a.id)}
                aria-label="에셋 삭제"
                className="absolute right-2 top-2 rounded-md bg-white/90 px-1.5 py-1 text-[11px] text-[#525252] opacity-0 ring-1 ring-[#EAEAEA] backdrop-blur-sm transition-opacity hover:text-red-600 group-hover:opacity-100"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
