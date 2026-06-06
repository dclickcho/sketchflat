-- =============================================================================
-- 팀 + 팀 라이브러리 + 팀 프로젝트 공유
-- =============================================================================
-- 테이블 생성 순서: teams → team_members → team_invitations → team_library_assets
-- projects.team_id 컬럼 추가
-- Storage 버킷 'team-library' 생성
-- SECURITY DEFINER 헬퍼 함수로 RLS 재귀 방지
-- 팀 생성·멤버 추가·초대 수락은 admin 클라이언트(service-role)로 처리하므로
--   INSERT 정책은 일부 테이블에서 의도적으로 생략.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. public.teams
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  created_by  uuid        not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- updated_at 자동 갱신 (공용 public.touch_updated_at() 재사용)
drop trigger if exists teams_touch_updated_at on public.teams;
create trigger teams_touch_updated_at
  before update on public.teams
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- 2. public.team_members
-- ---------------------------------------------------------------------------
create table if not exists public.team_members (
  team_id    uuid  not null references public.teams(id) on delete cascade,
  user_id    uuid  not null references auth.users(id)   on delete cascade,
  role       text  not null default 'member'
               check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_id_idx
  on public.team_members (user_id);


-- ---------------------------------------------------------------------------
-- 3. public.team_invitations
-- ---------------------------------------------------------------------------
create table if not exists public.team_invitations (
  id          uuid        primary key default gen_random_uuid(),
  team_id     uuid        not null references public.teams(id) on delete cascade,
  email       text        not null,
  role        text        not null default 'member'
                check (role in ('admin', 'member')),
  token       text        not null unique default encode(gen_random_bytes(16), 'hex'),
  invited_by  uuid        references auth.users(id) on delete set null,
  status      text        not null default 'pending'
                check (status in ('pending', 'accepted', 'revoked')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '14 days')
);

-- pending 상태인 (team_id, email) 조합은 중복 초대 방지
create unique index if not exists team_invitations_pending_email_idx
  on public.team_invitations (team_id, email)
  where status = 'pending';

create index if not exists team_invitations_token_idx
  on public.team_invitations (token);


-- ---------------------------------------------------------------------------
-- 4. projects.team_id 컬럼 추가
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists team_id uuid references public.teams(id) on delete set null;

-- team_id 가 있는 행만 색인 (null 제외)
create index if not exists projects_team_id_idx
  on public.projects (team_id)
  where team_id is not null;


-- ---------------------------------------------------------------------------
-- 5. public.team_library_assets
-- ---------------------------------------------------------------------------
create table if not exists public.team_library_assets (
  id           uuid  primary key default gen_random_uuid(),
  team_id      uuid  not null references public.teams(id) on delete cascade,
  name         text  not null,
  category     text  not null,
  storage_path text  not null,   -- 'team-library' 버킷의 <team_id>/<id>.svg
  created_by   uuid  references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists team_library_assets_team_id_idx
  on public.team_library_assets (team_id);


-- ---------------------------------------------------------------------------
-- 6. Storage 버킷 'team-library' (비공개)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('team-library', 'team-library', false)
  on conflict (id) do nothing;


-- ===========================================================================
-- SECURITY DEFINER 헬퍼 함수 — RLS 정책에서 team_members 재귀 방지
-- ===========================================================================

-- 현재 사용자가 해당 팀의 멤버(owner/admin/member)인지 확인
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from public.team_members
    where team_id = p_team_id
      and user_id = auth.uid()
  );
$$;

-- 현재 사용자가 해당 팀의 관리자(owner 또는 admin)인지 확인
create or replace function public.is_team_admin(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from public.team_members
    where team_id = p_team_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

-- storage.objects 정책 전용: 팀 ID를 text로 받아 멤버십 확인.
-- 다른 버킷(예: library-assets)의 비-uuid 경로를 ::uuid 캐스트해 쿼리 전체가
-- 깨지는 사고를 피하려고, uuid 캐스트 없이 team_id::text 와 비교한다.
create or replace function public.is_team_member_text(p_team_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from public.team_members
    where team_id::text = p_team_id
      and user_id = auth.uid()
  );
$$;


-- ===========================================================================
-- RLS 활성화
-- ===========================================================================
alter table public.teams               enable row level security;
alter table public.team_members        enable row level security;
alter table public.team_invitations    enable row level security;
alter table public.team_library_assets enable row level security;


-- ===========================================================================
-- teams 정책
-- INSERT 정책 없음 — 팀 생성은 admin 클라이언트(service-role)로만 수행
-- ===========================================================================

-- 멤버는 소속 팀 정보를 조회할 수 있다
drop policy if exists "teams_select_member" on public.teams;
create policy "teams_select_member" on public.teams
  for select
  using (public.is_team_member(id));

-- admin/owner 는 팀 정보를 수정할 수 있다
drop policy if exists "teams_update_admin" on public.teams;
create policy "teams_update_admin" on public.teams
  for update
  using (public.is_team_admin(id))
  with check (public.is_team_admin(id));

-- owner 만 팀을 삭제할 수 있다
drop policy if exists "teams_delete_owner" on public.teams;
create policy "teams_delete_owner" on public.teams
  for delete
  using (
    exists (
      select 1 from public.team_members
      where team_id = teams.id
        and user_id = auth.uid()
        and role = 'owner'
    )
  );


-- ===========================================================================
-- team_members 정책
-- INSERT/UPDATE 정책 없음 — 멤버 추가·역할 변경은 admin 클라이언트로만 수행
-- ===========================================================================

-- 같은 팀 멤버끼리 서로 조회 가능
drop policy if exists "team_members_select_member" on public.team_members;
create policy "team_members_select_member" on public.team_members
  for select
  using (public.is_team_member(team_id));

-- 본인 행만 직접 삭제 가능 (자진 탈퇴)
drop policy if exists "team_members_delete_self" on public.team_members;
create policy "team_members_delete_self" on public.team_members
  for delete
  using (user_id = auth.uid());


-- ===========================================================================
-- team_invitations 정책
-- INSERT/UPDATE/DELETE 정책 없음 — 초대 발급·수락·철회·토큰 조회는 admin 클라이언트로만 수행
-- ===========================================================================

-- admin/owner 만 자기 팀의 초대 목록을 조회할 수 있다
drop policy if exists "team_invitations_select_admin" on public.team_invitations;
create policy "team_invitations_select_admin" on public.team_invitations
  for select
  using (public.is_team_admin(team_id));


-- ===========================================================================
-- team_library_assets 정책
-- UPDATE 정책 없음 — 에셋 메타 수정이 필요하면 admin 클라이언트로 처리
-- ===========================================================================

-- 팀 멤버는 팀 라이브러리 에셋을 조회할 수 있다
drop policy if exists "team_library_assets_select_member" on public.team_library_assets;
create policy "team_library_assets_select_member" on public.team_library_assets
  for select
  using (public.is_team_member(team_id));

-- 팀 멤버는 팀 라이브러리에 에셋을 추가할 수 있다
drop policy if exists "team_library_assets_insert_member" on public.team_library_assets;
create policy "team_library_assets_insert_member" on public.team_library_assets
  for insert
  with check (public.is_team_member(team_id));

-- 팀 멤버는 팀 라이브러리 에셋을 삭제할 수 있다
drop policy if exists "team_library_assets_delete_member" on public.team_library_assets;
create policy "team_library_assets_delete_member" on public.team_library_assets
  for delete
  using (public.is_team_member(team_id));


-- ===========================================================================
-- projects 기존 정책 확장 — team_id 가 있는 경우 팀 멤버도 접근 허용
-- 기존 정책을 drop 후 재생성 (idempotent)
-- ===========================================================================

-- SELECT: 본인 프로젝트 또는 소속 팀 프로젝트
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects
  for select
  using (
    auth.uid() = user_id
    or (team_id is not null and public.is_team_member(team_id))
  );

-- INSERT: 본인이 소유자여야 하며, team_id 를 넣는 경우 해당 팀 멤버여야 함
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert
  with check (
    auth.uid() = user_id
    and (team_id is null or public.is_team_member(team_id))
  );

-- UPDATE: 본인 프로젝트 또는 소속 팀 프로젝트
drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update
  using (
    auth.uid() = user_id
    or (team_id is not null and public.is_team_member(team_id))
  )
  with check (
    auth.uid() = user_id
    or (team_id is not null and public.is_team_member(team_id))
  );

-- DELETE: 본인 프로젝트 또는 소속 팀 admin/owner
drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete
  using (
    auth.uid() = user_id
    or (team_id is not null and public.is_team_admin(team_id))
  );


-- ===========================================================================
-- storage.objects — 'team-library' 버킷 RLS
-- 경로 규칙: <team_id>/<asset_id>.svg
-- (storage.foldername(name))[1] 로 첫 세그먼트(team_id) 추출 후 uuid 캐스팅
-- ===========================================================================

-- 팀 멤버는 자기 팀 경로의 객체를 다운로드할 수 있다
drop policy if exists "team_library_objects_select_member" on storage.objects;
create policy "team_library_objects_select_member" on storage.objects
  for select
  using (
    bucket_id = 'team-library'
    and public.is_team_member_text((storage.foldername(name))[1])
  );

-- 팀 멤버는 자기 팀 경로에 객체를 업로드할 수 있다
drop policy if exists "team_library_objects_insert_member" on storage.objects;
create policy "team_library_objects_insert_member" on storage.objects
  for insert
  with check (
    bucket_id = 'team-library'
    and public.is_team_member_text((storage.foldername(name))[1])
  );

-- 팀 멤버는 자기 팀 경로의 객체를 교체(upsert)할 수 있다
drop policy if exists "team_library_objects_update_member" on storage.objects;
create policy "team_library_objects_update_member" on storage.objects
  for update
  using (
    bucket_id = 'team-library'
    and public.is_team_member_text((storage.foldername(name))[1])
  );

-- 팀 멤버는 자기 팀 경로의 객체를 삭제할 수 있다
drop policy if exists "team_library_objects_delete_member" on storage.objects;
create policy "team_library_objects_delete_member" on storage.objects
  for delete
  using (
    bucket_id = 'team-library'
    and public.is_team_member_text((storage.foldername(name))[1])
  );
