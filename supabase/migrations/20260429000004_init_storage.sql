-- Storage 버킷 + 경로 기반 RLS.
-- 모든 객체 경로는 '<user_id>/...' 로 시작. 다른 사용자 폴더 접근 차단.

insert into storage.buckets (id, name, public)
  values ('uploads', 'uploads', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('sketches', 'sketches', false)
  on conflict (id) do nothing;

-- uploads: 본인 폴더만 R/W
drop policy if exists "uploads_select_own" on storage.objects;
create policy "uploads_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "uploads_insert_own" on storage.objects;
create policy "uploads_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "uploads_update_own" on storage.objects;
create policy "uploads_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "uploads_delete_own" on storage.objects;
create policy "uploads_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- sketches: 본인 폴더만 R/W (생성은 주로 service_role webhook이 하지만 본인 R도 필요)
drop policy if exists "sketches_select_own" on storage.objects;
create policy "sketches_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sketches'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "sketches_insert_own" on storage.objects;
create policy "sketches_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sketches'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "sketches_update_own" on storage.objects;
create policy "sketches_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'sketches'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "sketches_delete_own" on storage.objects;
create policy "sketches_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'sketches'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
