-- =============================================================================
-- Advisor 정리 — 20260527000001~3 에서 새로 발생한 WARN/INFO 5건 일괄 처리
-- =============================================================================
-- 1. projects_touch_updated_at 함수에 search_path 고정 (function search_path mutable)
-- 2. avatars_select_public 정책 제거 (public 버킷 listing 노출)
-- 3. FK 미인덱싱 3건 인덱스 추가
-- 4. 새/확장 RLS 정책의 auth.uid() 를 (select auth.uid()) 로 래핑 (init-plan 1회)
-- 5. is_team_* 헬퍼의 anon EXECUTE 회수 (authenticated 는 RLS 평가에 필요해 유지)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. projects_touch_updated_at — search_path 고정
--    정의는 동일, set search_path = public 만 추가. 트리거 바인딩은 유지된다.
-- ---------------------------------------------------------------------------
create or replace function public.projects_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_favorite is distinct from old.is_favorite
     and new.title is not distinct from old.title
     and new.sketch is not distinct from old.sketch
     and new.thumbnail_url is not distinct from old.thumbnail_url then
    new.updated_at = old.updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. avatars 는 public 버킷 — 직접 URL 접근으로 충분. broad SELECT 정책 제거.
--    (insert/update/delete_own 정책은 유지)
-- ---------------------------------------------------------------------------
drop policy if exists "avatars_select_public" on storage.objects;


-- ---------------------------------------------------------------------------
-- 3. FK 미인덱싱 — 부모 행 삭제/조인 시 seq scan 회피
-- ---------------------------------------------------------------------------
create index if not exists teams_created_by_idx
  on public.teams (created_by);

create index if not exists team_invitations_invited_by_idx
  on public.team_invitations (invited_by);

create index if not exists team_library_assets_created_by_idx
  on public.team_library_assets (created_by);


-- ---------------------------------------------------------------------------
-- 4. RLS 정책 auth.uid() 래핑 — (select auth.uid()) 로 init-plan 1회 평가
--    로직 동일, 평가 방식만 변경.
-- ---------------------------------------------------------------------------

-- teams: owner 만 삭제
drop policy if exists "teams_delete_owner" on public.teams;
create policy "teams_delete_owner" on public.teams
  for delete
  using (
    exists (
      select 1 from public.team_members
      where team_id = teams.id
        and user_id = (select auth.uid())
        and role = 'owner'
    )
  );

-- team_members: 본인 행만 삭제 (자진 탈퇴)
drop policy if exists "team_members_delete_self" on public.team_members;
create policy "team_members_delete_self" on public.team_members
  for delete
  using (user_id = (select auth.uid()));

-- projects SELECT: 본인 프로젝트 또는 소속 팀 프로젝트
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects
  for select
  using (
    (select auth.uid()) = user_id
    or (team_id is not null and public.is_team_member(team_id))
  );

-- projects INSERT: 본인 소유 + team_id 넣으면 해당 팀 멤버
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert
  with check (
    (select auth.uid()) = user_id
    and (team_id is null or public.is_team_member(team_id))
  );

-- projects UPDATE: 본인 프로젝트 또는 소속 팀 프로젝트
drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update
  using (
    (select auth.uid()) = user_id
    or (team_id is not null and public.is_team_member(team_id))
  )
  with check (
    (select auth.uid()) = user_id
    or (team_id is not null and public.is_team_member(team_id))
  );

-- projects DELETE: 본인 프로젝트 또는 소속 팀 admin/owner
drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete
  using (
    (select auth.uid()) = user_id
    or (team_id is not null and public.is_team_admin(team_id))
  );


-- ---------------------------------------------------------------------------
-- 5. is_team_* SECURITY DEFINER 헬퍼 — anon 의 직접 RPC 호출 차단.
--    authenticated 는 RLS 평가에 필요하므로 EXECUTE 유지.
-- ---------------------------------------------------------------------------
revoke execute on function public.is_team_member(uuid)      from anon;
revoke execute on function public.is_team_admin(uuid)       from anon;
revoke execute on function public.is_team_member_text(text) from anon;
