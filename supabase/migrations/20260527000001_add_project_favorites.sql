-- projects.is_favorite: 프로젝트 선택화면의 "즐겨찾기" 목록을 위한 플래그.

alter table public.projects
  add column if not exists is_favorite boolean not null default false;

-- 즐겨찾기 뷰는 user_id 범위 안에서 is_favorite = true 인 행만 최신순으로 읽는다.
-- 부분 인덱스로 즐겨찾기한 소수의 행만 색인한다.
create index if not exists projects_favorite_idx
  on public.projects (user_id, updated_at desc)
  where is_favorite;

-- 즐겨찾기 토글은 콘텐츠 변경이 아니므로 updated_at(최근순 정렬 기준)을 흔들면 안 된다.
-- projects 전용 트리거로 교체: is_favorite 만 바뀐 경우 updated_at 을 보존한다.
create or replace function public.projects_touch_updated_at()
returns trigger
language plpgsql
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

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.projects_touch_updated_at();
