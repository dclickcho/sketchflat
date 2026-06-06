-- jobs.status에 'vectorizing' 추가.
-- Replicate webhook이 즉시 200을 반환하고, Arrow 호출은 별도 cron에서 처리하는 구조.
-- webhook handler → vectorizing → /api/cron/vectorize → succeeded/failed

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('pending', 'processing', 'vectorizing', 'succeeded', 'failed', 'canceled'));
