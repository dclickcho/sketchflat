-- jobs: 비동기 ML 작업 추적 (Replicate predictions, Arrow API 등).
-- kind: 어떤 종류의 작업인지 (image_to_sketch / sketch_to_image / vectorize 등)
-- status: 라이프사이클. Replicate webhook으로 갱신.
-- replicate_id: Replicate prediction id (있다면). 멱등성 키로도 사용.

create table if not exists public.jobs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  project_id         uuid references public.projects(id) on delete set null,
  kind               text not null check (kind in ('image_to_sketch', 'sketch_to_image', 'vectorize')),
  status             text not null default 'pending'
                     check (status in ('pending', 'processing', 'succeeded', 'failed', 'canceled')),
  replicate_id       text unique,
  input              jsonb,
  output_sketch_url  text,
  output_image_url   text,
  error_message      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists jobs_user_id_idx on public.jobs (user_id, created_at desc);
create index if not exists jobs_project_id_idx on public.jobs (project_id);
create index if not exists jobs_status_idx on public.jobs (status);

alter table public.jobs enable row level security;

-- 자신의 job만 조회
drop policy if exists "jobs_select_own" on public.jobs;
create policy "jobs_select_own" on public.jobs
  for select using (auth.uid() = user_id);

-- 자신을 user_id로만 INSERT 허용
drop policy if exists "jobs_insert_own" on public.jobs;
create policy "jobs_insert_own" on public.jobs
  for insert with check (auth.uid() = user_id);

-- UPDATE/DELETE는 일반 클라이언트에서 막음 — webhook은 service_role로만 갱신.
-- (필요 시 추후 'jobs_cancel_own' 같은 좁은 정책 추가)

drop trigger if exists jobs_touch_updated_at on public.jobs;
create trigger jobs_touch_updated_at
  before update on public.jobs
  for each row execute function public.touch_updated_at();
