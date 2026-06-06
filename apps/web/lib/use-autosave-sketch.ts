'use client';
// sketch가 바뀔 때마다 디바운스해 PATCH /api/projects/[id]를 호출.
// markSketchSynced로 마킹된 상태와 동일하면 저장하지 않으므로, 서버에서 막 받은 직후의
// setSketch는 저장 사이클을 트리거하지 않는다.
//
// 언마운트 시 보류 중인 디바운스가 있으면 keepalive fetch로 즉시 flush.
// 이렇게 하지 않으면 사용자가 1.2s 디바운스 안에 페이지를 떠날 때 (예: AI 생성 직후
// 빠르게 돌아가기 클릭) 변경분이 저장되지 않아 다음 진입 시 도식화가 사라진다.

import { useEffect, useRef } from 'react';
import { useEditorStore } from '@/lib/editor-store';
import { saveSketchDraft, clearSketchDraft } from '@/lib/web-storage';
import type { Sketch } from '@sketchflat/svg-schema';

const DEBOUNCE_MS = 1200;

export function useAutosaveSketch(projectId: string) {
  const sketch = useEditorStore((s) => s.sketch);
  const lastSavedSketchJson = useEditorStore((s) => s.lastSavedSketchJson);
  const markSketchSynced = useEditorStore((s) => s.markSketchSynced);
  const setSaveStatus = useEditorStore((s) => s.setSaveStatus);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 디바운스 중인 최신 스냅샷. 언마운트 시 keepalive로 flush할 때 사용.
  const pendingRef = useRef<Sketch | null>(null);

  useEffect(() => {
    if (!sketch) return;
    const nextJson = JSON.stringify(sketch);
    if (nextJson === lastSavedSketchJson) {
      // 서버와 이미 동기화된 상태면 보류분도 비움.
      pendingRef.current = null;
      return;
    }

    pendingRef.current = sketch;

    // 서버 PATCH(디바운스) 전에 즉시 localStorage 에 draft 보존 — 새로고침/이탈 시 복원용.
    saveSketchDraft(projectId, sketch);

    if (timerRef.current !== null) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      const snapshot = pendingRef.current;
      if (!snapshot) return;
      pendingRef.current = null;

      // 직전 인플라이트 요청은 취소 — 새 디바운스가 올라온 경우엔 더 최신 sketch가 곧 저장된다.
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSaveStatus('saving');

      try {
        const res = await fetch(`/api/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sketch: snapshot }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const message =
            (body as { error?: { message?: string } }).error?.message ??
            `자동저장 실패 (${res.status})`;
          console.error('[autosave]', message);
          setSaveStatus('error');
          return;
        }
        // 보낸 스냅샷 기준으로 동기화 표시. 인플라이트 중에 들어온 추가 편집은
        // 다음 effect 사이클에서 lastSavedSketchJson과 다시 비교돼 또 저장된다.
        markSketchSynced(snapshot);
        // 서버에 안전히 반영됨 — 로컬 draft 는 더 이상 필요 없으므로 정리.
        clearSketchDraft(projectId);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        console.error('[autosave] network error', err);
        setSaveStatus('error');
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    }, DEBOUNCE_MS);
  }, [sketch, lastSavedSketchJson, projectId, markSketchSynced, setSaveStatus]);

  // 언마운트 / 탭 종료 직전 보류분 flush. keepalive: true로 페이지 이탈 후에도
  // 요청이 완료되게 함. projectId가 바뀌는 경우(다른 프로젝트로 이동)에도 직전
  // 프로젝트의 보류분을 먼저 보낸다.
  useEffect(() => {
    function flushPending() {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const snapshot = pendingRef.current;
      pendingRef.current = null;
      if (!snapshot) return;
      // 언마운트/이탈 후라 응답을 받아 상태를 갱신할 수 없음 — 결과는 무시.
      void fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sketch: snapshot }),
        keepalive: true,
      }).catch(() => {
        /* 이탈 후 에러 보고 경로 없음 */
      });
    }

    // 탭 종료 / 백그라운드 전환 — pagehide가 unload보다 BFCache와 호환됨.
    window.addEventListener('pagehide', flushPending);

    return () => {
      window.removeEventListener('pagehide', flushPending);
      // SPA 내 페이지 이탈 (예: 돌아가기 링크 클릭).
      flushPending();
    };
  }, [projectId]);
}
