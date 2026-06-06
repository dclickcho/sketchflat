-- projects: 사용자의 도식화 프로젝트.
-- sketch는 packages/svg-schema 의 Sketch 타입과 일치하는 JSON.

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default '제목 없음',
  sketch      jsonb,             -- @sketchpack/svg-schema Sketch (nullable: 빈 프로젝트)
  thumbnail_url text,            -- Storage sketches/<user_id>/<project_id>.png
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;

-- 자신의 프로젝트만 조회
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects
  for select using (auth.uid() = user_id);

-- 자신을 user_id로 INSERT만 허용
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert with check (auth.uid() = user_id);

-- 자신의 프로젝트만 수정
drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 자신의 프로젝트만 삭제
drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete using (auth.uid() = user_id);

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();
