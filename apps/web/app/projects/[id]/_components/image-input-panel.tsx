'use client';
// 하단 플로팅 툴바 위로 펼쳐지는 image input 박스. 툴바의 Sparkle(AI 생성) 버튼이
// imageInputOpen 을 토글하면 scaleY 트랜지션으로 위로 자라거나 다시 툴바 안으로 접힌다.
// 파일 선택 시 자체적으로 패널을 접고 280ms 뒤에 부모 onFileChange 로 위임한다.

import { useRef, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { useEditorStore } from '@/lib/editor-store';

interface ImageInputPanelProps {
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

// label 의 <input accept> 과 동일한 허용 MIME 목록 — 드롭된 파일 검증에 재사용.
const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

export function ImageInputPanel({ onFileChange }: ImageInputPanelProps) {
  const imageInputOpen = useEditorStore((s) => s.imageInputOpen);
  const setImageInputOpen = useEditorStore((s) => s.setImageInputOpen);
  // 파일을 고른 직후 접힘 모션을 보여주고, 트랜지션이 끝난 뒤에 실제 업로드 핸들러로 위임.
  // 그 사이 다른 클릭/파일 선택을 막기 위해 ref 로 in-flight 상태를 잠근다.
  const pendingRef = useRef(false);
  // 드롭된 파일을 hidden input 의 files 로 주입해 기존 change 흐름을 그대로 재사용한다.
  const inputRef = useRef<HTMLInputElement>(null);
  // 드래그가 박스 위에 머무는 동안 테두리/색을 강조하기 위한 시각 상태.
  const [isDragging, setIsDragging] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    if (pendingRef.current) return;
    pendingRef.current = true;
    setImageInputOpen(false);
    window.setTimeout(() => {
      onFileChange(e);
      pendingRef.current = false;
    }, 280);
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    if (collapsed) return;
    // 드롭을 허용하려면 dragover 의 기본 동작을 반드시 막아야 한다.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    // 자식 요소로 이동하는 경우는 무시하고, label 영역을 실제로 벗어날 때만 해제.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (collapsed || pendingRef.current) return;
    const file = Array.from(e.dataTransfer.files).find((f) =>
      ACCEPTED_TYPES.includes(f.type),
    );
    if (!file) return;
    const input = inputRef.current;
    if (!input) return;
    // DataTransfer 로 hidden input.files 를 채운 뒤 동일한 change 핸들러로 위임 —
    // 파일 선택 경로와 업로드 로직을 한 곳으로 모은다.
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    handleChange({ target: input } as React.ChangeEvent<HTMLInputElement>);
  };

  const collapsed = !imageInputOpen;

  return (
    <div
      // floating-toolbar 와 같은 z-20. bottom=64 (toolbar bottom-4=16px + h-12=48px) 로 툴바 윗변에 정확히 붙는다.
      // width=430 은 툴바 전체 너비(Sparkle 그룹 50 + 도구 그룹 7×50 + gap 14 + px-2 16)에 맞춘 값
      //   — Sparkle 에도 chevron(14px)이 붙어 그룹 폭이 50 이 되며, 좌우 변이 툴바와 정렬된다.
      className="pointer-events-none absolute z-20"
      style={{ bottom: 64, left: '50%', marginLeft: -215, width: 430 }}
      aria-hidden={collapsed}
    >
      <div
        style={{
          transformOrigin: 'bottom center',
          transform: collapsed ? 'scaleY(0)' : 'scaleY(1)',
          opacity: collapsed ? 0 : 1,
          transition:
            'transform 320ms cubic-bezier(0.32, 0.72, 0.2, 1), opacity 240ms ease-out',
          willChange: 'transform, opacity',
          pointerEvents: collapsed ? 'none' : 'auto',
        }}
      >
        <label
          // 위쪽만 둥글게 + 아래쪽은 직각/border-b-0 — 툴바 윗변과 한 덩어리처럼 보이도록.
          // 외곽: 실선 1.5px / 내부(아래): 점선 1px 의 이중 테두리.
          className="relative flex flex-col items-center justify-center gap-1.5 cursor-pointer rounded-t-xl border-[1.5px] border-b-0 border-solid py-11 shadow-sm hover:border-neutral-500 transition-colors group"
          style={{
            borderColor: isDragging ? '#525252' : 'hsl(var(--editor-border))',
            backgroundColor: isDragging ? '#f5f5f5' : '#ffffff',
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1.5 right-1.5 top-1.5 bottom-0 rounded-t-[8px] border border-b-0 border-dashed transition-colors group-hover:border-neutral-400"
            style={{ borderColor: isDragging ? '#a3a3a3' : 'hsl(var(--editor-border))' }}
          />
          <ImageIcon
            size={20}
            strokeWidth={1.5}
            className="text-neutral-500"
            aria-hidden="true"
          />
          <span
            className="text-[13px] text-neutral-700 font-sans"
            style={{ letterSpacing: '-0.14px' }}
          >
            Image input
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="sr-only"
            onChange={handleChange}
            disabled={collapsed}
          />
        </label>
      </div>
    </div>
  );
}
