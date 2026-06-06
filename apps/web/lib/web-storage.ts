'use client';
// Web Storage 헬퍼 — 서버(Supabase)를 source of truth로 두고, 클라이언트 저장소는
// "즉시 복원 / 휘발성 상태" 용도로만 쓴다.
//
//   localStorage   : 새로고침·재접속 후에도 유지돼야 하는 것 (에디터 draft, UI 환경설정).
//   sessionStorage : 탭이 열려 있는 동안만 의미 있는 것 (진행 중인 AI 생성 작업 상태).
//
// SSR 안전: window 가 없으면 전부 no-op. quota/직렬화 실패는 best-effort로 무시.

import type { Sketch } from '@sketchflat/svg-schema';

const hasWindow = () => typeof window !== 'undefined';

function readJSON<T>(storage: Storage, key: string): T | null {
  if (!hasWindow()) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJSON(storage: Storage, key: string, value: unknown): void {
  if (!hasWindow()) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota/직렬화 실패 — 로컬 캐시는 best-effort */
  }
}
function removeKey(storage: Storage, key: string): void {
  if (!hasWindow()) return;
  try {
    storage.removeItem(key);
  } catch {
    /* noop */
  }
}

// ── localStorage: 에디터 자동저장 draft ────────────────────────────────────
// 서버 PATCH 가 디바운스되는 동안/실패 시에도 마지막 편집을 로컬에 보존한다.
// 다음 진입 시 서버본보다 최신이면 복원해 작업 환경을 잃지 않게 한다.
const draftKey = (projectId: string) => `sketchflat:draft:${projectId}`;

export type SketchDraft = { sketch: Sketch; savedAt: number };

export function saveSketchDraft(projectId: string, sketch: Sketch): void {
  writeJSON(localStorage, draftKey(projectId), {
    sketch,
    savedAt: Date.now(),
  } satisfies SketchDraft);
}
export function loadSketchDraft(projectId: string): SketchDraft | null {
  return readJSON<SketchDraft>(localStorage, draftKey(projectId));
}
export function clearSketchDraft(projectId: string): void {
  removeKey(localStorage, draftKey(projectId));
}

// ── localStorage: UI 환경설정 ──────────────────────────────────────────────
const UI_PREFS_KEY = 'sketchflat:ui-prefs';
export type UiPrefs = { uiMinimized?: boolean };

export function loadUiPrefs(): UiPrefs | null {
  return readJSON<UiPrefs>(localStorage, UI_PREFS_KEY);
}
export function saveUiPrefs(prefs: UiPrefs): void {
  if (!hasWindow()) return;
  const merged = { ...(loadUiPrefs() ?? {}), ...prefs };
  writeJSON(localStorage, UI_PREFS_KEY, merged);
}

// ── sessionStorage: 진행 중 AI 생성 작업 ───────────────────────────────────
// 탭 단위 휘발성. 새로고침 시 "생성 중" 상태를 복원해 폴링을 재개할 수 있게 한다.
const genKey = (projectId: string) => `sketchflat:gen:${projectId}`;

export type GenJobState = { jobId: string; status: string; startedAt: number };

export function saveGenJob(projectId: string, state: GenJobState): void {
  writeJSON(sessionStorage, genKey(projectId), state);
}
export function loadGenJob(projectId: string): GenJobState | null {
  return readJSON<GenJobState>(sessionStorage, genKey(projectId));
}
export function clearGenJob(projectId: string): void {
  removeKey(sessionStorage, genKey(projectId));
}
