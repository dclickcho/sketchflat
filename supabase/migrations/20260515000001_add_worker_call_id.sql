-- jobs.worker_call_id: Modal 워커의 비동기 call_id 를 cron tick 간에 영속한다.
--   submit→poll 구조에서 첫 tick 에 submit 후 저장, 이후 tick 에서 poll 에 재사용.
--   nullable — 아직 submit 되지 않은 행(기존 rows 포함)은 null.
--   제약 없음 — call_id 형식은 워커 구현에 의존.

alter table public.jobs
  add column if not exists worker_call_id text;
