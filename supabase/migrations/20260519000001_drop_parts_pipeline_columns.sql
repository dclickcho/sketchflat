-- 2026-05-19 — parts(YOLO+LIVE) 파이프라인 폐기에 따른 컬럼 제거.
--   pipeline_kind  : 'arrow' 단일 경로로 복귀했으므로 분기 컬럼 불요.
--   worker_call_id : Modal 워커 폐기로 영속할 call_id 없음.
-- 체크 제약(jobs_pipeline_kind_check)도 함께 정리.

alter table public.jobs
  drop constraint if exists jobs_pipeline_kind_check;

alter table public.jobs
  drop column if exists pipeline_kind;

alter table public.jobs
  drop column if exists worker_call_id;
