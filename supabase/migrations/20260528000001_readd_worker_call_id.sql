-- jobs.worker_call_id 재추가 — v6 Modal 워커 submit→poll 2-phase 복원.
--   2026-05-15 에 parts 파이프라인용으로 도입했다가 2026-05-19 폐기(drop)했으나,
--   v6 face-finding 워커가 동일한 비동기 패턴을 쓰므로 되살린다.
--   첫 tick 에 POST /submit 후 call_id 저장, 이후 tick 에서 GET /status 폴링에 재사용.
--   nullable — 아직 submit 안 된 행은 null. 형식 제약 없음(워커 구현 의존).

alter table public.jobs
  add column if not exists worker_call_id text;
