import { type Sketch, type Anchor, fillToCssColor } from '@sketchflat/svg-schema';

// Konva PathConfig에서 실제로 필요한 필드만 추린 타입.
// react-konva의 PathConfig 전체를 import하면 konva 버전 의존성이 생기므로
// 렌더러 레이어에서는 이 단순한 형태로만 다룬다.
export interface RenderedPathConfig {
  data: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface RenderedPart {
  id: string;
  category: string;
  z_index: number;
  paths: RenderedPathConfig[];
  anchors: Anchor[];
}

/**
 * Sketch.parts 배열 → RenderedPart 배열.
 * z_index 오름차순으로 정렬해 반환하므로 Konva Layer에 순서대로 그리면 된다.
 * parts가 비어있는 경우(raw_svg 폴백 케이스)는 빈 배열 반환.
 */
export function sketchToRenderedParts(sketch: Sketch): RenderedPart[] {
  if (sketch.parts.length === 0) return [];

  return [...sketch.parts]
    .sort((a, b) => a.z_index - b.z_index)
    .map((part) => ({
      id: part.id,
      category: part.category,
      z_index: part.z_index,
      paths: part.svg_paths.map((pathData) => ({
        data: pathData,
        // 이 경로는 Konva 가 아닌 다른 출력(서버측 미리보기 등)에 쓰이는 직렬 형태라
        // 그라디언트는 평균색으로 떨군다.
        fill: fillToCssColor(part.fill),
        stroke: part.stroke,
        strokeWidth: part.stroke_width,
      })),
      anchors: part.anchors,
    }));
}

/**
 * SVG 문자열 → Base64 data URL.
 * Konva.Image의 src로 사용하기 위한 변환.
 * 브라우저 전용 (btoa + encodeURIComponent 의존). SSR 컨텍스트에서 호출하면
 * 빈 문자열을 반환해 Konva.Image가 아무것도 그리지 않게 한다.
 */
export function svgToDataUrl(svgString: string): string {
  if (typeof window === 'undefined') return '';

  // btoa는 ASCII 범위만 처리하므로 유니코드 문자가 있는 SVG는 encodeURIComponent → unescape 경유.
  try {
    const encoded = encodeURIComponent(svgString).replace(
      /%([0-9A-F]{2})/g,
      (_match, p1: string) => String.fromCharCode(parseInt(p1, 16)),
    );
    const base64 = btoa(encoded);
    return `data:image/svg+xml;base64,${base64}`;
  } catch {
    // 인코딩 실패 시 data URI scheme으로 직접 전달 (fallback)
    return `data:image/svg+xml,${encodeURIComponent(svgString)}`;
  }
}

/**
 * Sketch의 canvas 크기를 읽어 반환.
 * Stage 초기화나 KonvaImage 사이즈 세팅에 사용.
 */
export function getCanvasSize(sketch: Sketch): { width: number; height: number } {
  return { width: sketch.canvas.width, height: sketch.canvas.height };
}
