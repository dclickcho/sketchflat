-- jobs.pipeline_kind: 벡터화 파이프라인 선택.
--   'arrow'  → 기존 Quiver Arrow 1.1 (parseArrowSvgServer)
--   'parts'  → YOLOv8 + LIVE 부위별 벡터화 (vectorizePartsImage)
--
-- 기본값 'arrow' 로 기존 행과 신규 행 모두 자연스럽게 Arrow 경로 진입.
-- 환경변수 VECTORIZE_PIPELINE=parts 가 설정되면 webhook 가 신규 job 을 'parts' 로 스탬프.
-- 롤백은 환경변수 제거 또는 'arrow' 로 변경하면 즉시 — 기존 코드 라인 변경 없음.

alter table public.jobs
  add column if not exists pipeline_kind text not null default 'arrow';

alter table public.jobs
  drop constraint if exists jobs_pipeline_kind_check;
alter table public.jobs
  add constraint jobs_pipeline_kind_check
  check (pipeline_kind in ('arrow', 'parts'));
