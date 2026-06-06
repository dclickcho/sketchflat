-- 프로필 아바타/역할 컬럼과 public 아바타 버킷 도입.
-- 아바타 이미지는 별도 public 버킷에 저장하여 <user_id>/avatar.* 경로에 두고,
-- profiles.avatar_url 에 public URL 또는 storage path 를 보관한다.

alter table public.profiles
  add column if not exists avatar_url text;

alter table public.profiles
  add column if not exists role text;

insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

-- avatars: 모두 읽기 가능(public), 본인 폴더만 W
drop policy if exists "avatars_select_public" on storage.objects;
create policy "avatars_select_public" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
