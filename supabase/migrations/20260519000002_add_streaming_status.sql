-- jobs.status에 'streaming' 추가.
-- 클라이언트가 SSE 라우트로 직접 Arrow stream:true 를 받으면서 정본까지 한 번에 저장하는 통합 경로.
-- 흐름:  vectorizing → (SSE 라우트가 atomic 락) → streaming → succeeded
-- SSE 가 도중에 끊기면 streaming → vectorizing 으로 되돌려 cron 이 백업으로 픽업한다.

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('pending', 'processing', 'vectorizing', 'streaming', 'succeeded', 'failed', 'canceled'));
