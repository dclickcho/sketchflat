-- 사용자에게 제공되는 사전 제작 SVG 에셋 카탈로그 (카라/소매/몸판/단추 등).
-- 메타데이터는 library_assets 테이블, 실제 SVG 파일은 library-assets 공개 버킷의
-- {category_dir}/{slug}.svg 경로에 저장. 익명 사용자도 카탈로그/파일을 자유롭게 읽을 수 있다.

insert into storage.buckets (id, name, public)
  values ('library-assets', 'library-assets', true)
  on conflict (id) do nothing;

create table if not exists public.library_assets (
  id text primary key,
  name text not null,
  category text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists library_assets_category_idx on public.library_assets (category);

alter table public.library_assets enable row level security;

drop policy if exists "library_assets_select_all" on public.library_assets;
create policy "library_assets_select_all" on public.library_assets
  for select to anon, authenticated
  using (true);

-- library-assets 버킷 객체에 대한 공개 read.
drop policy if exists "library_assets_object_select_all" on storage.objects;
create policy "library_assets_object_select_all" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'library-assets');

-- 시드: Round Collar. SVG 파일 자체는 별도 업로드 스크립트로 버킷에 올린다.
-- 명명 규칙 — name 은 변형명 (예: "Round Collar"), category 는 부품 타입 (예: "Collar").
-- 라이브러리 적용 시 그룹명은 `${category} (${name})` = "Collar (Round Collar)".
insert into public.library_assets (id, name, category, storage_path)
  values ('collar-round', 'Round Collar', 'Collar', 'collar/round.svg')
  on conflict (id) do nothing;

insert into public.library_assets (id, name, category, storage_path)
  values ('sleeve-puff', 'Puff Sleeve', 'Sleeve', 'sleeve/puff.svg')
  on conflict (id) do nothing;
