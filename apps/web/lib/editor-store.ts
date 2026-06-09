import { create } from 'zustand';
import { temporal } from 'zundo';
import { immer } from 'zustand/middleware/immer';
import {
  type Sketch,
  type Part,
  type PartFill,
  type Transform,
  type Anchor,
  type AnchorKind,
  type Artboard,
  type BrushDefinition,
  type BrushApplication,
  DEFAULT_TRANSFORM,
  compileAnchorsToD,
  flattenPart,
} from '@sketchflat/svg-schema';
import { parseRawSvgToParts } from '@/lib/svg-to-parts';
import { serializeSelectedPartsToSvg } from '@/lib/export-parts';
import { fitPartsToBbox } from '@/lib/fit-parts-to-bbox';
import { expandBrushPart } from '@/lib/expand-brush';
import { findBrushDefinition } from '@/lib/brush-lookup';
import {
  LIBRARY_ASSET_CATEGORY_ALIASES,
} from '@/lib/library-asset-snapshots';
// polygon-clipping@0.15 은 API 객체를 default 로, 타입을 named 로 export 한다.
// `import * as` 로 받으면 ESM 빌드에서 union/difference 등이 namespace 에 안 잡혀
// 런타임에 undefined 가 되므로 default import + named type import 로 분리한다.
import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Ring, Pair } from 'polygon-clipping';
import paper from 'paper/dist/paper-core';
import {
  partToPaperItem,
  knifeToPaperItem,
  paperItemToPieces,
  pieceToPart,
  isMeaningful,
  disposePaperItem,
} from '@/lib/pathfinder-paper';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export type JobStatus = 'idle' | 'pending' | 'running' | 'done' | 'error';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type PanelMode = 'layers' | 'library' | 'brushes';

// 보기 메뉴/단축키가 캔버스에 요청하는 뷰포트 명령. 실제 줌 계산은 컨테이너 크기·대지를
// 아는 canvas-panel 에서 수행하므로, 메뉴(좌측 패널)는 이 명령만 큐에 넣고 canvas-panel 이
// 소비한다. 줌 인/아웃, 100%, 화면 맞춤, 선택 영역 맞춤.
export type ViewCommand = 'zoom-in' | 'zoom-out' | 'zoom-100' | 'zoom-fit' | 'zoom-selection';

// 라이브러리 모달에서 추가한 사전 제작 에셋 — 좌측 라이브러리 탭에 카드로 노출.
// 식별자/이름/카테고리 + 공개 SVG URL. svgUrl 은 카드 미리보기 + 캔버스 적용 시 fetch 소스.
// sketch 와 분리되어 메모리에만 머무르며 undo 대상이 아니다.
export interface LibraryAsset {
  id: string;
  name: string;
  category: string;
  svgUrl: string;
}

// 캔버스의 패스를 좌측 라이브러리 패널로 끌어다 놓아 직접 추가한 에셋이 들어가는 카테고리.
// 사전 제작 카탈로그(카테고리별)와 구분되는 "내 라이브러리" 섹션으로 좌측 패널에 노출된다.
export const MY_LIBRARY_CATEGORY = '내 라이브러리';

// 이름 입력 팝업에 넘기는 임시 에셋 초안 — 드롭 시점에 직렬화한 SVG data URL + 기본 이름.
export interface PendingAssetDraft {
  svgUrl: string;
  defaultName: string;
}
// 'select'      = 일러스트레이터의 검은 화살표(V). 파트 통째로 이동·회전·스케일.
// 'direct-select' = 흰 화살표(A). 앵커/핸들/세그먼트 편집 전용. 파트 자체는 못 움직임.
// 'pen'         = 펜툴(P). 빈 캔버스에서 새 path를 그려나가거나 기존 path 끝에 이어그리기.
// 'artboard'    = 대지툴(M). 캔버스에 새 대지를 드래그로 생성, 기존 대지 클릭 선택.
// 'rect'        = 사각형 도형(R). 드래그로 직사각형 part 생성.
// 'ellipse'     = 원/타원 도형(O). 드래그로 4-앵커 cubic 근사 ellipse part 생성.
// 'eyedropper'  = 스포이드(I). 일러스트레이터 스포이드 — 선택된 파트(들)를 대상으로,
//                 다른 파트를 클릭하면 그 파트의 채우기/획 스타일을 복사해 입힌다.
export type EditorTool =
  | 'select'
  | 'direct-select'
  | 'pan'
  | 'zoom'
  | 'pen'
  | 'artboard'
  | 'rect'
  | 'ellipse'
  | 'eyedropper';

// 정렬/분배 — 다중 선택 파트의 world bbox를 기준으로 transform.x/y만 조정한다.
// 회전은 무시(현실적으로 정렬은 회전이 0인 파트에 거의 한정).
export type AlignAction =
  | 'align-left'
  | 'align-center-h'
  | 'align-right'
  | 'align-top'
  | 'align-middle-v'
  | 'align-bottom'
  | 'distribute-h'
  | 'distribute-v';

export interface PartStylePatch {
  // fill 은 단색 string("#abc"/"none") 또는 그라디언트/패턴 객체 — Part.fill 과 동일.
  // 그라디언트 편집기는 LinearGradientFill/RadialGradientFill 객체 그대로 전달한다.
  fill?: PartFill;
  stroke?: string;
  stroke_width?: number;
  // 점선. undefined = 패치 미적용, null = 점선 해제(=실선), 배열 = 새 패턴.
  // (Part.stroke_dasharray 자체는 optional<number[]> 이라 null 표현이 없음 → 패치 레벨에서만 사용.)
  stroke_dasharray?: number[] | null;
  stroke_linecap?: 'butt' | 'round' | 'square';
}

// 직접선택툴에서 다중 앵커 선택을 표현하는 단위. partId/anchorId 쌍 — 같은 anchor id가 다른
// part에 있을 수 있으므로 둘 다 필요. 마퀴/Shift-클릭으로 다중 part 의 앵커가 한 selection 에
// 동시에 들어갈 수 있다.
export interface AnchorRef {
  partId: string;
  anchorId: string;
}

interface EditorState {
  sketch: Sketch | null;
  selectedPartIds: string[];
  /** 직접선택툴 단일 앵커 선택 — selectedAnchors[length-1] 의 anchorId 와 항상 동일. 단일 선택
   *  중심으로 짜인 기존 코드 호환을 위해 유지. */
  selectedAnchorId: string | null;
  /** 직접선택툴 다중 앵커 선택. 마퀴/Shift-클릭/Ctrl+J 등에서 사용. selectedAnchorId 와 동기화. */
  selectedAnchors: AnchorRef[];
  selectedArtboardId: string | null;
  activeTool: EditorTool;
  viewport: Viewport;
  panelMode: PanelMode;
  jobStatus: JobStatus;
  // 자동저장 상태. 서버와의 동기화 상황을 표시하기 위한 마지막 저장된 sketch JSON 스냅샷.
  saveStatus: SaveStatus;
  lastSavedSketchJson: string | null;
  // 내부 클립보드 — Ctrl+C로 채우고 Ctrl+V로 비우지 않은 채 복제. 시스템 클립보드와는 별개.
  clipboardParts: Part[];
  // 좌/우 패널 + 플로팅 툴바를 숨겨 캔버스만 보여주는 모드. 빈 영역 우클릭 메뉴에서 토글.
  hideUI: boolean;
  // figma 처럼 좌측 위에 미니 헤더만 남기고 좌/우 패널을 숨기는 "최소화" 모드. 플로팅 툴바는 유지.
  // 좌측 패널 헤더 상단 행(로고와 같은 높이) 우측의 PanelLeft 버튼으로 토글.
  uiMinimized: boolean;
  // 캔버스 가장자리에 world 좌표 눈금자(상단 가로 + 좌측 세로)를 표시할지. 보기 메뉴 / Shift+R.
  showRuler: boolean;
  // 보기 메뉴·단축키가 큐에 넣는 1회성 뷰포트 명령. canvas-panel 이 소비 후 즉시 null 로 비운다.
  pendingViewCommand: ViewCommand | null;
  // 하단 플로팅 툴바의 Sparkle(AI 생성) 버튼이 토글하는 image input 패널의 노출 상태.
  // 첫 진입(=phase 'upload')에서 true 로 시작, 파일 선택 / 다른 프로젝트 진입 시 false.
  // 'ai' 는 EditorTool 이 아니라 별도 토글 — activeTool 은 건드리지 않는다(커서 기본 유지).
  imageInputOpen: boolean;
  // 라이브러리 관리 모달에서 추가된 에셋 목록. 좌측 라이브러리 탭이 비어있을 때
  // 카드 그리드로 보여 주기 위한 단순 배열. id 기준 dedupe.
  libraryAssets: LibraryAsset[];
  // 캔버스에서 패스를 좌측 라이브러리 패널로 드래그하는 중인지 — 좌측 패널의 드롭존
  // 하이라이트를 켜고 끄는 데 쓴다. 드롭(또는 취소) 시 false 로 돌아간다.
  partAssetDragActive: boolean;
  // 드래그 중 포인터가 실제로 좌측 패널(드롭존) 위에 올라와 있는지 — 강조 표시 강도를 높인다.
  partAssetDropHover: boolean;
  // 드롭 직후 이름 입력 팝업에 넘길 임시 에셋 초안. 팝업이 열려 있는 동안만 non-null.
  pendingAssetDraft: PendingAssetDraft | null;
  // 우측 채우기 → 그라디언트 편집 popover 의 open 상태. 캔버스의 그라디언트 핸들 바 표시
  // 조건과 lifetime 을 공유한다 — popover 가 열려야만 핸들이 보이고, part 드래그/변형 시
  // popover 가 닫히면서 핸들도 자연스럽게 사라진다.
  isGradientPanelOpen: boolean;
  // 현재 선택된 그라디언트 stop 인덱스. 우측 popover 의 Stops 리스트와 캔버스 핸들 바의
  // swatch 가 이 값을 공유해 같은 stop 이 양쪽에서 파란색으로 강조된다.
  selectedStopIndex: number;
}

export interface ArtboardPatch {
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface EditorActions {
  /** 그라디언트 편집 popover open 상태 토글. canvas-panel 은 이 값이 true 일 때만
   *  핸들 바를 그린다. part 드래그/변형 시작 시 false 로 닫아 popover·핸들을 같이 사라지게. */
  setGradientPanelOpen: (open: boolean) => void;
  /** 선택된 그라디언트 stop 인덱스 설정. popover·캔버스 swatch 강조를 동기화한다. */
  setSelectedStopIndex: (i: number) => void;
  /** sketch 교체. null 을 넘기면 sketch + 선택 + 자동저장 baseline(lastSavedSketchJson)을 모두
   *  비운다 — 다른 프로젝트로 이동하거나 신규(빈) 프로젝트 진입 시 직전 sketch가 좌측 패널에
   *  남는 것을 막기 위함. */
  setSketch: (sketch: Sketch | null) => void;
  /** raw_svg가 있고 parts가 비어있으면 DOMParser로 파싱해 parts에 흡수. */
  ingestRawSvgAsParts: () => void;
  /** raw_svg를 다시 파싱해 각 파트의 스타일 필드만 (stroke_width, dasharray, linecap, linejoin)
   *  매칭 id로 갱신. svg_paths/transform/anchors 등 사용자 편집 가능한 필드는 보존.
   *  fill/stroke는 updatePartStyle이 raw_svg를 갱신하지 않아 stale하므로 제외 — 덮으면
   *  사용자가 채운 색이 매 로드마다 되돌아간다.
   *  과거 파서가 stroke-width fallback 1.5로 저장한 케이스를 자동 복구하기 위한 용도. */
  refreshPartStylesFromRawSvg: () => void;
  /** anchors=[]로 저장된 기존 파트에 raw_svg를 다시 파싱해 anchors / subpath_breaks /
   *  subpath_closed만 복구. 사용자 편집(transform, fill/stroke, svg_paths 자체)은 일절 건드리지 않는다.
   *  앵커 편집 기능이 추가되기 전에 만들어진 프로젝트를 자동 마이그레이션하기 위한 용도. */
  backfillAnchorsFromRawSvg: () => void;

  // 선택
  selectPart: (id: string | null, additive?: boolean) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  /** 단일 앵커 선택. id=null 이면 selectedAnchors 도 비운다. partId 가 주어지지 않으면
   *  selectedPartIds 또는 sketch 에서 anchor 가 속한 part 를 추론. */
  selectAnchor: (id: string | null, partId?: string) => void;
  /** 다중 앵커 선택을 통째로 교체. 비어 있으면 selectedAnchorId 도 null. */
  selectAnchors: (refs: AnchorRef[]) => void;
  /** 마퀴 / Shift+클릭 추가 선택. 중복 ref 는 자동 dedupe (anchorId 기준). */
  addAnchorsToSelection: (refs: AnchorRef[]) => void;
  /** 단일 ref 토글 (이미 있으면 제거, 없으면 추가). */
  toggleAnchorInSelection: (ref: AnchorRef) => void;
  /** 모든 앵커 선택 해제 — part 선택은 유지. */
  clearAnchorSelection: () => void;
  /** 선택된 앵커들을 (dx, dy) 만큼 평행이동. 같은 part 의 한 앵커당 한 번만 이동되도록 dedupe.
   *  핸들도 함께 평행이동. */
  translateAnchors: (refs: AnchorRef[], dx: number, dy: number) => void;
  /** 다중 앵커 일괄 삭제. part 별로 묶어 한 번에 처리하고, 각 part 의 anchors 가 모두 사라지면
   *  part 자체를 삭제. */
  deleteAnchors: (refs: AnchorRef[]) => void;
  /** 두 끝점을 직선으로 연결 (Illustrator: Object > Path > Join, Ctrl+J).
   *  refs.length === 2 일 때만 의미. 케이스:
   *   - 같은 서브패스의 양 끝점 → 닫음 (Z).
   *   - 같은 part 의 다른 서브패스의 끝점들 → 두 서브패스를 잇기 (필요시 reverse).
   *   - 다른 part 의 끝점들 → 첫 번째 part 로 흡수, transform 보정 후 잇기.
   *  연결 후 결과 서브패스의 양 끝점이 같은 위치에 있으면 자동으로 닫는다 — 두 열린 path 의
   *  반대쪽 endpoint 들이 마침 일치하는 케이스에서 사용자가 또 한 번 연결을 누르지 않아도 됨.
   *  endpoint 가 아닌 anchor 에 대해선 no-op. */
  joinAnchors: (refs: AnchorRef[]) => void;
  /** 직접 선택 툴에서 앵커를 드래그 끝낸 직후 호출. 드래그된 앵커가 (열린) 서브패스의 한쪽 끝점이고
   *  반대쪽 끝점과 snapEps 이내라면, 정확히 그 위치로 스냅한 뒤 서브패스를 닫는다.
   *  snapEps 는 part-local 단위 (호출자가 zoom/scale 보정해서 전달). */
  trySnapCloseAtAnchors: (refs: AnchorRef[], snapEps: number) => void;

  // 변형 / 스타일
  updatePartTransform: (id: string, transform: Transform) => void;
  /** 여러 파트의 transform을 한 번의 set()으로 일괄 적용. 그룹 드래그/변형이
   *  파트당 별도 undo 스냅샷을 만들지 않고 한 번에 되돌려지도록 보장. */
  updatePartTransforms: (updates: Array<{ id: string; transform: Transform }>) => void;
  updatePartStyle: (id: string, patch: PartStylePatch) => void;
  /** 스포이드(I) — sourceId 파트의 외형 스타일(fill/stroke/stroke_width/dasharray/linecap/linejoin)을
   *  targetIds 의 각 파트에 복사한다. 일러스트레이터 스포이드와 동일하게 색상·획 속성만 옮기고
   *  좌표/앵커/변형은 건드리지 않는다. source 가 target 에 포함돼 있으면 그 항목은 건너뛴다. */
  copyStyleFromPart: (sourceId: string, targetIds: string[]) => void;

  // 앵커/핸들 편집 — 일러스트레이터 펜툴 스타일.
  // 모든 액션이 변경 직후 part.anchors → svg_paths[0]을 다시 컴파일하므로
  // 렌더(Konva.Path data) 갱신은 자동.
  /** 앵커 좌표만 평행이동(핸들도 같은 delta로 같이 이동). */
  updateAnchorPosition: (partId: string, anchorId: string, x: number, y: number) => void;
  /** 한쪽 핸들 좌표 직접 설정. smooth/asymmetric 모드에선 반대편 핸들을 미러링. */
  updateHandle: (
    partId: string,
    anchorId: string,
    side: 'in' | 'out',
    x: number,
    y: number,
  ) => void;
  /** 앵커의 코너/스무스 모드 토글. smooth로 바꿀 때 핸들이 이미 있으면 평균 방향으로 정렬. */
  setAnchorKind: (partId: string, anchorId: string, kind: AnchorKind) => void;
  /** 세그먼트(=anchors[fromIdx]→anchors[toIdx]) 위 t 위치에 새 앵커 삽입. cubic이면 De Casteljau로 분할,
   *  직선이면 단순 lerp. 새 앵커 id를 반환하지 않고 selectedAnchorId로 직접 셋팅 — 호출자가 바로 드래그 가능. */
  insertAnchor: (
    partId: string,
    fromIdx: number,
    toIdx: number,
    isClosing: boolean,
    t: number,
  ) => void;
  /** 앵커 1개 제거. 인접 cubic은 재계산하지 않고 단순히 양옆 핸들로 이어진 새 segment가 된다.
   *  서브패스가 1개 앵커만 남고 그 앵커가 지워지면 서브패스 자체가 정리된다. */
  deleteAnchor: (partId: string, anchorId: string) => void;
  /** 펜툴: 신규 빈 part 생성 (anchors=1개로 시작). 생성된 part id 반환. */
  createPenPart: (initial: { x: number; y: number; handle_out?: { x: number; y: number } }) => string | null;
  /** 펜툴: 기존 part의 마지막 서브패스 끝에 anchor 한 개 추가. */
  appendAnchorToPart: (
    partId: string,
    anchor: { x: number; y: number; handle_in?: { x: number; y: number }; handle_out?: { x: number; y: number } },
  ) => void;
  /** 펜툴: 끊긴(열린) 패스의 끝점 anchor 를 클릭해 이어그리기를 재개.
   *  대상 서브패스를 part 의 *마지막* 서브패스로 재배치하고, 클릭한 끝점이
   *  anchors 배열의 마지막 원소가 되도록 (시작점이면 서브패스를 뒤집어) 정렬한다.
   *  이후 appendAnchorToPart / setLastAnchorHandleOut / closeLastSubpath 가
   *  그대로 동작한다. 성공 시 partId, 실패(닫힌 서브패스·끝점 아님·잠금 등) 시 null. */
  resumePenAtAnchor: (partId: string, anchorId: string) => string | null;
  /** 펜툴: 마지막에 추가된 anchor의 handle_out (그리고 smooth면 handle_in도) 갱신.
   *  click-drag 중 마우스 이동마다 호출. */
  setLastAnchorHandleOut: (
    partId: string,
    handle_out: { x: number; y: number },
    mirrorIn: boolean,
  ) => void;
  /** 펜툴: 마지막 서브패스를 닫음 (Z). 닫고 나면 펜 드래프트가 끝난다. */
  closeLastSubpath: (partId: string) => void;

  // CRUD
  duplicateParts: (ids: string[]) => void;
  deleteParts: (ids: string[]) => void;

  // 컨텍스트 메뉴 — 반전 / 정렬 순서 / 표시 / 잠금. group_id가 같은 파트는 같은 단위로 묶여 처리.
  /** 좌우 반전(Shift+H) — 각 파트 transform.scaleX 부호를 뒤집고 자기 bbox 중심 기준으로 위치 보정. */
  flipPartsHorizontal: (ids: string[]) => void;
  /** 상하 반전(Shift+V) — scaleY 부호 뒤집고 위치 보정. */
  flipPartsVertical: (ids: string[]) => void;
  /** 맨 앞으로 가져오기(]) — 선택 파트들의 z_index를 현재 최댓값+1부터 순차 부여. */
  bringToFront: (ids: string[]) => void;
  /** 맨 뒤로 보내기([) — 최솟값 - n부터 순차 부여해 가장 아래로. */
  sendToBack: (ids: string[]) => void;
  /** 표시/숨기기 토글 — 선택 안에 하나라도 visible=false 가 있으면 모두 visible=true로,
   *  모두 visible 이면 모두 hidden 으로. */
  toggleVisibility: (ids: string[]) => void;
  /** 잠금/잠금 해제 토글 — 마찬가지로 다수결 흐름. */
  toggleLock: (ids: string[]) => void;

  // 도형 생성 — 사각형/타원. world(=캔버스) 좌표의 rect를 입력으로 받아 anchors-based part 생성.
  createRectPart: (rect: { x: number; y: number; width: number; height: number }) => string | null;
  createEllipsePart: (rect: { x: number; y: number; width: number; height: number }) => string | null;

  // 정렬/분배 — 선택된 파트가 2개 이상일 때만 의미. 1개 이하면 no-op.
  alignParts: (action: AlignAction) => void;

  // Pathfinder — 일러스트레이터 Object > Path > Pathfinder 와 같은 동작.
  // 두 개 이상의 파트의 폐곡 서브패스를 평면 폴리곤으로 평탄화한 뒤 polygon-clipping 으로 합치거나
  // 분할한다. cubic 핸들은 평탄화 정확도(epsilon)에 따라 corner anchor 들의 폴리라인으로 환원된다.
  /** Unite — 모든 입력 파트의 폐곡 영역을 합쳐 하나(또는 분리된 외곽 수만큼)의 새 part 로 교체.
   *  스타일/카테고리/이름은 z_index 가 가장 위인 입력 파트를 템플릿으로 승계. */
  unitePaths: (ids: string[]) => void;
  /** Divide — 입력 파트들의 폐곡 영역을 평면 분할해 모든 부분 영역을 별개 part 로 분리.
   *  N=2 의 경우 A∩B / A−B / B−A 세 영역. N>=3 은 좌→우(z_index 오름차순) 으로 누적 분할.
   *  각 조각의 스타일은 그 영역을 차지한 원본 파트(겹침 영역은 위쪽 파트)를 따라간다. */
  dividePaths: (ids: string[]) => void;
  /** Subtract (Minus Front / Figma Subtract) — z_index 최저 파트(=가장 아래)가 베이스, 나머지를 빼낸 결과.
   *  스타일은 베이스 파트 승계. 결과가 비면 no-op. */
  subtractPaths: (ids: string[]) => void;
  /** Intersect — 모든 입력 파트의 교집합. 스타일은 z_index 최상위 파트 승계. 결과가 비면 no-op. */
  intersectPaths: (ids: string[]) => void;
  /** Exclude — 대칭 차집합 (XOR). 모든 입력에서 홀수 개 영역만 남김. 스타일은 z_index 최상위 파트 승계. */
  excludePaths: (ids: string[]) => void;

  // 그룹 — 새 group_id 부여 / 제거. ids는 보통 selectedPartIds.
  /** 그룹화. 선택 안에 어떤 그룹의 모든 후손 파트가 포함돼 있으면 그 그룹은 분해되지 않고
   *  통째로 새 그룹의 자식이 된다 (sketch.group_parents 로 연결). 결과적으로 "그룹 안의 그룹". */
  groupParts: (ids: string[]) => void;
  ungroupParts: (ids: string[]) => void;
  /** 한 파트의 직속 그룹 멤버 파트 id 들을 반환. 없으면 자기 자신만. */
  getGroupMemberIds: (partId: string) => string[];
  /** 한 그룹의 모든 후손 파트 id 들을 반환 (재귀, 서브 그룹의 멤버까지 포함). */
  getGroupDescendantPartIds: (groupId: string) => string[];

  // 레이어 패널 드래그-앤-드롭. items 는 part 또는 group 단위. target 은 다른 항목 위/아래 또는
  // 어떤 그룹의 자식으로 드롭. z_index 는 트리 평탄화 후 N..1 로 전체 재할당된다.
  moveLayers: (
    items: { kind: 'part' | 'group'; id: string }[],
    target:
      | { kind: 'before' | 'after'; refKind: 'part' | 'group'; refId: string }
      | { kind: 'into-group'; groupId: string }
      | { kind: 'root-end' },
  ) => void;

  // 이름 변경 — 레이어/그룹의 라벨. 빈 문자열을 넘기면 폴백("Vector N" / "그룹")으로 되돌린다.
  renamePart: (id: string, name: string) => void;
  renameGroup: (groupId: string, name: string) => void;

  // 클립보드 / 미세 이동
  /** 선택 파트 스냅샷을 내부 clipboardParts에 저장. ids가 비면 no-op. */
  copyParts: (ids: string[]) => void;
  /** clipboardParts를 +12,+12 오프셋으로 다시 추가. 새 파트들이 자동 선택된다. */
  pasteParts: () => void;
  /** ids에 속한 파트들의 transform.x/y를 dx/dy만큼 이동. 화살표 nudge용. */
  nudgeParts: (ids: string[], dx: number, dy: number) => void;

  // 대지 (Artboard)
  /** 대지 생성. 이름은 기본 "대지N" — 기존 대지 수 + 1. 생성된 id 반환. */
  createArtboard: (rect: { x: number; y: number; width: number; height: number }) => string | null;
  /** sketch.canvas 그대로의 크기로 대지1을 한 번 시드. artboards가 이미 있으면 no-op.
   *  AI 생성 도식화가 올라간 캔버스를 자동으로 "대지1"로 인식시키기 위한 1회성 마이그레이션. */
  seedDefaultArtboardFromCanvas: () => void;
  /** 대지 단일 선택. null이면 해제. */
  selectArtboard: (id: string | null) => void;
  /** 대지 속성(이름/좌표/크기) 부분 갱신. */
  updateArtboard: (id: string, patch: ArtboardPatch) => void;
  /** 대지 삭제. */
  deleteArtboard: (id: string) => void;

  // UI
  setActiveTool: (tool: EditorTool) => void;
  setJobStatus: (status: JobStatus) => void;
  setViewport: (v: Viewport) => void;
  setPanelMode: (mode: PanelMode) => void;

  // 자동저장
  /** 현재 sketch가 서버 상태와 동일하다고 표시. lastSavedSketchJson을 갱신하고 saveStatus를 'saved'로. */
  markSketchSynced: (sketch: Sketch) => void;
  setSaveStatus: (status: SaveStatus) => void;

  /** UI 숨기기 토글 — 캔버스 외 패널/툴바를 모두 숨겨 작업 영역을 최대화. */
  toggleHideUI: () => void;
  /** UI 최소화 토글 — 좌/우 패널만 숨기고 좌측 위에 미니 헤더 유지. 플로팅 툴바는 그대로. */
  toggleUIMinimized: () => void;
  /** 눈금자 표시 토글 (보기 > 눈금자, Shift+R). */
  toggleRuler: () => void;
  /** 보기 메뉴/단축키 → canvas-panel 로 뷰포트 명령 전달. canvas-panel 이 실행 후 clear 한다. */
  requestViewCommand: (cmd: ViewCommand) => void;
  /** canvas-panel 이 pendingViewCommand 를 실행한 뒤 호출해 큐를 비운다. */
  clearViewCommand: () => void;

  /** Sparkle(AI 생성) 버튼이 토글하는 image input 패널의 노출 세터/토글. */
  setImageInputOpen: (open: boolean) => void;
  toggleImageInput: () => void;

  // 라이브러리 에셋
  /** 모달에서 선택한 에셋들을 좌측 라이브러리 탭에 추가. 이미 추가된 id 는 자동 dedupe. */
  addLibraryAssets: (assets: LibraryAsset[]) => void;
  /** 좌측 라이브러리 탭 카드의 X 버튼으로 단일 에셋 제거. */
  removeLibraryAsset: (id: string) => void;

  // 캔버스 → 좌측 라이브러리 패널 드래그로 에셋 추가
  /** 캔버스에서 패스 드래그가 진행 중인지 토글 — 좌측 패널 드롭존 하이라이트용. */
  setPartAssetDragActive: (active: boolean) => void;
  /** 드래그 포인터가 좌측 패널 위에 올라와 있는지 토글 — 강조 강도 전환용. */
  setPartAssetDropHover: (hover: boolean) => void;
  /** 드래그한 파트들을 현재 위치/크기 그대로 SVG 로 직렬화해 이름 입력 팝업용 초안으로
   *  보관하고, 좌측 패널을 라이브러리 탭으로 전환한다. */
  requestAssetFromParts: (partIds: string[]) => void;
  /** 이름 입력 팝업 취소 — 초안 폐기. */
  cancelPendingAsset: () => void;
  /** 이름 입력 팝업 확인 — 초안을 "내 라이브러리" 카테고리 에셋으로 좌측 패널에 추가. */
  commitPendingAsset: (name: string) => void;
  /** 라이브러리 카드 클릭 — 캔버스에서 카테고리와 같은 이름(예: "카라")의 최상위 그룹을 찾아
   *  파트들의 visible=false 로 숨기고, 해당 그룹의 world bbox 에 새 에셋을 스케일·정렬해 추가.
   *  기존 그룹 자체는 삭제되지 않으며 레이어 패널에서 가시성을 다시 켜면 원래대로 돌아온다.
   *  매칭되는 그룹이 없으면 캔버스 중앙에 원본 크기로 배치 (fallback). */
  applyLibraryAssetToCanvas: (assetId: string) => Promise<void>;

  /** 외부에서 가져온 벡터(SVG 문자열)를 현재 스케치에 새 그룹으로 흡수한다. 일러스트레이터
   *  .ai/.pdf 는 호출 전에 SVG 로 변환되어 들어오고, .svg 는 그대로 들어온다.
   *  스케치가 아직 없으면(업로드 단계) 빈 스케치를 만들어 그 위에 올린다 — 캔버스가
   *  parts>0 를 감지해 자동으로 canvas phase 로 전환한다. 캔버스 80% 안에 비율 유지로
   *  축소·중앙 배치하며, 원본 fill/stroke 는 parseRawSvgToParts 가 그대로 보존한다. */
  importExternalVector: (rawSvg: string, label: string) => void;

  // 패턴 브러쉬
  /** 파트의 svg_paths(spine)에 브러쉬를 적용 — part.brush = { brush_id } 설정. 렌더는 캔버스가
   *  동적으로 수행한다. partId 생략 시 선택된 단일 파트에 적용. */
  applyBrushToPart: (brushId: string, partId?: string) => void;
  /** 적용된 브러쉬의 파라미터(scale/spacing/flip/fit/stroke 등)를 부분 갱신. */
  updatePartBrushParams: (partId: string, patch: Partial<Omit<BrushApplication, 'brush_id'>>) => void;
  /** 파트에서 브러쉬 제거 — 다시 일반 패스로 되돌린다. */
  removeBrushFromPart: (partId: string) => void;
  /** 사용자가 SVG 로 반입한 브러쉬 정의를 스케치에 저장 (id 기준 dedupe/덮어쓰기). */
  addUserBrush: (def: BrushDefinition) => void;
  /** 사용자 브러쉬 정의 제거. 해당 브러쉬를 쓰던 파트의 brush 참조도 함께 해제. */
  removeUserBrush: (brushId: string) => void;
  /** 브러쉬를 실제 파트(편집 가능한 anchors)로 굽는다 — 동적 spine 파트를 제거하고 타일들을
   *  한 그룹으로 대체. partId 생략 시 선택된 단일 파트. */
  expandBrush: (partId?: string) => void;
}

type EditorStore = EditorState & EditorActions;

export const useEditorStore = create<EditorStore>()(
  temporal(
    immer((set, get) => ({
      sketch: null,
      selectedPartIds: [],
      selectedAnchorId: null,
      selectedAnchors: [],
      selectedArtboardId: null,
      activeTool: 'select',
      viewport: { x: 0, y: 0, zoom: 1 },
      panelMode: 'layers',
      jobStatus: 'idle',
      saveStatus: 'idle',
      lastSavedSketchJson: null,
      clipboardParts: [],
      hideUI: false,
      uiMinimized: false,
      showRuler: false,
      pendingViewCommand: null,
      imageInputOpen: false,
      libraryAssets: [],
      partAssetDragActive: false,
      partAssetDropHover: false,
      pendingAssetDraft: null,
      isGradientPanelOpen: false,
      selectedStopIndex: 0,

      setGradientPanelOpen: (open) =>
        set((state) => {
          state.isGradientPanelOpen = open;
        }),

      setSelectedStopIndex: (i) =>
        set((state) => {
          state.selectedStopIndex = i;
        }),

      setSketch: (sketch) =>
        set((state) => {
          state.sketch = sketch;
          state.selectedPartIds = [];
          state.selectedAnchorId = null;
          state.selectedAnchors = [];
          state.selectedArtboardId = null;
          // null 진입(=프로젝트 전환/신규 프로젝트 초기화) 시 자동저장 baseline 도 같이 비운다.
          // 그렇지 않으면 새 프로젝트의 첫 sketch가 직전 baseline과 비교돼 즉시 PATCH 가 나간다.
          if (sketch === null) {
            state.lastSavedSketchJson = null;
            state.saveStatus = 'idle';
            state.jobStatus = 'idle';
          }
        }),

      ingestRawSvgAsParts: () =>
        set((state) => {
          const s = state.sketch;
          if (!s) return;
          if (s.parts.length > 0) return;
          if (!s.raw_svg) return;

          const parsed = parseRawSvgToParts(s.raw_svg);
          if (!parsed || parsed.parts.length === 0) return;

          s.parts = parsed.parts;
          // 캔버스 크기를 SVG에서 추론한 값으로 업데이트.
          if (parsed.canvas.width > 0 && parsed.canvas.height > 0) {
            s.canvas = parsed.canvas;
          }
          // v6 워커가 <g id="part-…" data-label="…"> 로 부위별 그룹을 박아 보내므로,
          // 흡수 시점에 그 트리를 그대로 sketch.group_names/group_parents 에 시드한다.
          // 이후 사용자가 그룹 추가/이름 변경한 결과가 정답이 된다.
          if (!s.group_names) s.group_names = {};
          if (!s.group_parents) s.group_parents = {};
          for (const [gid, name] of Object.entries(parsed.groupNames)) {
            s.group_names[gid] = name;
          }
          for (const [child, parent] of Object.entries(parsed.groupParents)) {
            s.group_parents[child] = parent;
          }
          // raw_svg는 의도적으로 보존 — Arrow 원본과 parts 렌더 결과를 비교하는
          // 디버그/검증 뷰에서 그대로 다시 띄울 수 있도록. parts가 1개 이상이면
          // 렌더 분기는 parts 경로를 타기 때문에 KonvaImage 폴백이 중복 그려지지는 않는다.
          s.updated_at = new Date().toISOString();
        }),

      refreshPartStylesFromRawSvg: () =>
        set((state) => {
          const s = state.sketch;
          if (!s?.raw_svg) return;
          if (s.parts.length === 0) return;

          const parsed = parseRawSvgToParts(s.raw_svg);
          if (!parsed || parsed.parts.length === 0) return;

          // 파트 id가 `part_<tag>_<index>` 형태로 raw_svg DOM 순서에 결정적이므로
          // 같은 raw_svg를 다시 파싱하면 id 매칭이 안정적으로 유지된다.
          const freshById = new Map(parsed.parts.map((p) => [p.id, p]));
          let changed = false;

          for (const part of s.parts) {
            const fresh = freshById.get(part.id);
            if (!fresh) continue;
            // fill / stroke 는 사용자가 명시적으로 바꾸는 색상 필드 — raw_svg 는
            // updatePartStyle 에서 갱신되지 않으므로 stale 함. 여기서 덮으면 사용자가
            // 채워둔 색이 다음 로드에 매번 되돌아간다 (회귀). 색상은 손대지 않는다.
            if (part.stroke_width !== fresh.stroke_width) {
              part.stroke_width = fresh.stroke_width;
              changed = true;
            }
            const aDash = JSON.stringify(part.stroke_dasharray ?? null);
            const bDash = JSON.stringify(fresh.stroke_dasharray ?? null);
            if (aDash !== bDash) {
              part.stroke_dasharray = fresh.stroke_dasharray;
              changed = true;
            }
            if (part.stroke_linecap !== fresh.stroke_linecap) {
              part.stroke_linecap = fresh.stroke_linecap;
              changed = true;
            }
            if (part.stroke_linejoin !== fresh.stroke_linejoin) {
              part.stroke_linejoin = fresh.stroke_linejoin;
              changed = true;
            }
            // 그룹 백필 — 과거에는 svg-to-parts 가 <g> 를 무시해 모든 파트가 평탄히
            // 들어왔다. raw_svg 에 그룹 정보가 살아 있는 옛 프로젝트도 다시 열면
            // 그룹이 잡히도록 비어있는 group_id 만 채운다 (사용자가 만든 그룹은 보존).
            if (!part.group_id && fresh.group_id) {
              part.group_id = fresh.group_id;
              changed = true;
            }
          }

          // 그룹 메타 백필 — 기존 키는 절대 덮지 않는다 (사용자가 바꾼 이름·중첩 보존).
          if (!s.group_names) s.group_names = {};
          if (!s.group_parents) s.group_parents = {};
          for (const [gid, name] of Object.entries(parsed.groupNames)) {
            if (s.group_names[gid] === undefined) {
              s.group_names[gid] = name;
              changed = true;
            }
          }
          for (const [child, parent] of Object.entries(parsed.groupParents)) {
            if (s.group_parents[child] === undefined) {
              s.group_parents[child] = parent;
              changed = true;
            }
          }

          if (changed) {
            s.updated_at = new Date().toISOString();
          }
        }),

      backfillAnchorsFromRawSvg: () =>
        set((state) => {
          const s = state.sketch;
          if (!s?.raw_svg) return;
          if (s.parts.length === 0) return;

          const parsed = parseRawSvgToParts(s.raw_svg);
          if (!parsed || parsed.parts.length === 0) return;

          const freshById = new Map(parsed.parts.map((p) => [p.id, p]));
          let changed = false;

          for (const part of s.parts) {
            // anchors가 이미 있으면 사용자 편집을 보존 — 절대 덮어쓰지 않음.
            if (part.anchors.length > 0) continue;
            const fresh = freshById.get(part.id);
            if (!fresh) continue;
            if (fresh.anchors.length === 0) continue;
            // 신선한 파싱 결과의 path-로컬 좌표를 그대로 가져온다. svg_paths는 건드리지 않으며,
            // 이후 사용자가 앵커를 편집하면 recompilePartPath가 svg_paths[0]을 새로 컴파일.
            part.anchors = JSON.parse(JSON.stringify(fresh.anchors));
            part.subpath_breaks = fresh.subpath_breaks
              ? [...fresh.subpath_breaks]
              : undefined;
            part.subpath_closed = fresh.subpath_closed
              ? [...fresh.subpath_closed]
              : undefined;
            changed = true;
          }

          if (changed) {
            s.updated_at = new Date().toISOString();
          }
        }),

      selectPart: (id, additive = false) =>
        set((state) => {
          // 선택만으로는 그라디언트 핸들/UI 를 띄우지 않는다. 이 패널은 오른쪽 패널의
          // 채우기 스와치를 직접 눌러 "UI 에 들어갈 때만" 켜져야 한다. 전역 store 값이라
          // 켜둔 채 다른 part 를 선택하면 따라붙던 문제를 선택 변경 시 닫아서 막는다.
          if (id === null) {
            state.selectedPartIds = [];
            state.selectedAnchorId = null;
            state.selectedAnchors = [];
            state.isGradientPanelOpen = false;
            return;
          }
          if (additive) {
            const idx = state.selectedPartIds.indexOf(id);
            if (idx >= 0) state.selectedPartIds.splice(idx, 1);
            else state.selectedPartIds.push(id);
          } else {
            // 같은 part 를 다시 누른 게 아니라 선택이 실제로 바뀔 때만 패널을 닫는다.
            const changed = state.selectedPartIds.length !== 1 || state.selectedPartIds[0] !== id;
            if (changed) state.isGradientPanelOpen = false;
            state.selectedPartIds = [id];
          }
          state.selectedAnchorId = null;
          state.selectedAnchors = [];
          state.selectedArtboardId = null;
        }),

      selectMany: (ids) =>
        set((state) => {
          state.selectedPartIds = [...ids];
          state.selectedAnchorId = null;
          state.selectedAnchors = [];
          state.selectedArtboardId = null;
          state.isGradientPanelOpen = false;
        }),

      clearSelection: () =>
        set((state) => {
          state.selectedPartIds = [];
          state.selectedAnchorId = null;
          state.selectedAnchors = [];
          state.selectedArtboardId = null;
          state.isGradientPanelOpen = false;
        }),

      selectAnchor: (id, partId) =>
        set((state) => {
          if (id === null) {
            state.selectedAnchorId = null;
            state.selectedAnchors = [];
            return;
          }
          // partId 가 안 들어오면 현재 선택된 part 들 또는 sketch 전체에서 anchor 위치 추론.
          let resolvedPartId = partId;
          if (!resolvedPartId && state.sketch) {
            const candidates = state.selectedPartIds.length > 0
              ? state.sketch.parts.filter((p) => state.selectedPartIds.includes(p.id))
              : state.sketch.parts;
            const found = candidates.find((p) => p.anchors.some((a) => a.id === id));
            if (found) resolvedPartId = found.id;
          }
          state.selectedAnchorId = id;
          if (resolvedPartId) {
            state.selectedAnchors = [{ partId: resolvedPartId, anchorId: id }];
          } else {
            state.selectedAnchors = [];
          }
        }),

      selectAnchors: (refs) =>
        set((state) => {
          // anchorId 기준 dedupe (같은 anchorId 가 다른 part 에 있더라도 selectedAnchors 의 partId
          // 까지 함께 비교). 입력 순서를 보존.
          const seen = new Set<string>();
          const next: AnchorRef[] = [];
          for (const r of refs) {
            const key = `${r.partId}:${r.anchorId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            next.push({ partId: r.partId, anchorId: r.anchorId });
          }
          state.selectedAnchors = next;
          state.selectedAnchorId = next.length > 0 ? next[next.length - 1]!.anchorId : null;
          // 앵커가 속한 part 들이 selectedPartIds 에 포함되도록 보정 — 다중 part 마퀴 시
          // 오버레이가 켜지려면 selectedPartIds 가 그 part 들을 포함해야 한다.
          if (next.length > 0) {
            const partIds = Array.from(new Set(next.map((r) => r.partId)));
            state.selectedPartIds = partIds;
            state.selectedArtboardId = null;
          }
        }),

      addAnchorsToSelection: (refs) =>
        set((state) => {
          const existing = new Set(
            state.selectedAnchors.map((r) => `${r.partId}:${r.anchorId}`),
          );
          for (const r of refs) {
            const key = `${r.partId}:${r.anchorId}`;
            if (existing.has(key)) continue;
            existing.add(key);
            state.selectedAnchors.push({ partId: r.partId, anchorId: r.anchorId });
          }
          if (state.selectedAnchors.length > 0) {
            state.selectedAnchorId = state.selectedAnchors[state.selectedAnchors.length - 1]!.anchorId;
            const partIds = new Set(state.selectedPartIds);
            for (const r of state.selectedAnchors) partIds.add(r.partId);
            state.selectedPartIds = Array.from(partIds);
            state.selectedArtboardId = null;
          }
        }),

      toggleAnchorInSelection: (ref) =>
        set((state) => {
          const key = `${ref.partId}:${ref.anchorId}`;
          const idx = state.selectedAnchors.findIndex(
            (r) => `${r.partId}:${r.anchorId}` === key,
          );
          if (idx >= 0) {
            state.selectedAnchors.splice(idx, 1);
          } else {
            state.selectedAnchors.push({ partId: ref.partId, anchorId: ref.anchorId });
          }
          state.selectedAnchorId = state.selectedAnchors.length > 0
            ? state.selectedAnchors[state.selectedAnchors.length - 1]!.anchorId
            : null;
          if (state.selectedAnchors.length > 0) {
            const partIds = new Set(state.selectedPartIds);
            for (const r of state.selectedAnchors) partIds.add(r.partId);
            state.selectedPartIds = Array.from(partIds);
            state.selectedArtboardId = null;
          }
        }),

      clearAnchorSelection: () =>
        set((state) => {
          state.selectedAnchors = [];
          state.selectedAnchorId = null;
        }),

      translateAnchors: (refs, dx, dy) =>
        set((state) => {
          if (!state.sketch || refs.length === 0) return;
          if (dx === 0 && dy === 0) return;
          // part 별로 묶어 한 번씩만 recompile.
          const byPart = new Map<string, Set<string>>();
          for (const r of refs) {
            let s = byPart.get(r.partId);
            if (!s) {
              s = new Set();
              byPart.set(r.partId, s);
            }
            s.add(r.anchorId);
          }
          for (const [partId, anchorIdSet] of byPart) {
            const part = state.sketch.parts.find((p) => p.id === partId);
            if (!part) continue;
            for (const a of part.anchors) {
              if (!anchorIdSet.has(a.id)) continue;
              a.x += dx;
              a.y += dy;
              if (a.handle_in) {
                a.handle_in.x += dx;
                a.handle_in.y += dy;
              }
              if (a.handle_out) {
                a.handle_out.x += dx;
                a.handle_out.y += dy;
              }
            }
            recompilePartPath(part);
          }
          state.sketch.updated_at = new Date().toISOString();
        }),

      deleteAnchors: (refs) =>
        set((state) => {
          if (!state.sketch || refs.length === 0) return;
          const byPart = new Map<string, Set<string>>();
          for (const r of refs) {
            let s = byPart.get(r.partId);
            if (!s) {
              s = new Set();
              byPart.set(r.partId, s);
            }
            s.add(r.anchorId);
          }

          const partIdsToDelete: string[] = [];

          for (const [partId, anchorIdSet] of byPart) {
            const part = state.sketch.parts.find((p) => p.id === partId);
            if (!part) continue;
            // 큰 인덱스부터 지워야 인덱스 밀림이 없다.
            const targetIndices = part.anchors
              .map((a, i) => (anchorIdSet.has(a.id) ? i : -1))
              .filter((i) => i >= 0)
              .sort((a, b) => b - a);
            for (const idx of targetIndices) {
              removeAnchorAt(part, idx);
            }
            if (part.anchors.length === 0) {
              partIdsToDelete.push(partId);
            } else {
              recompilePartPath(part);
            }
          }

          if (partIdsToDelete.length > 0) {
            const dropSet = new Set(partIdsToDelete);
            state.sketch.parts = state.sketch.parts.filter((p) => !dropSet.has(p.id));
            state.selectedPartIds = state.selectedPartIds.filter((id) => !dropSet.has(id));
          }
          state.selectedAnchors = [];
          state.selectedAnchorId = null;
          state.sketch.updated_at = new Date().toISOString();
        }),

      joinAnchors: (refs) =>
        set((state) => {
          if (!state.sketch) return;
          if (refs.length !== 2) return;

          const a = refs[0]!;
          const b = refs[1]!;

          const partA = state.sketch.parts.find((p) => p.id === a.partId);
          const partB = state.sketch.parts.find((p) => p.id === b.partId);
          if (!partA || !partB) return;

          const epA = findEndpointInfo(partA, a.anchorId);
          const epB = findEndpointInfo(partB, b.anchorId);
          if (!epA || !epB) return;

          if (a.partId === b.partId) {
            // 같은 part — 같은 서브패스이면 close, 다른 서브패스이면 두 서브패스를 잇기.
            if (epA.subIdx === epB.subIdx) {
              const closed = [...(partA.subpath_closed ?? [])];
              const breaks = partA.subpath_breaks ?? [];
              const subCount = 1 + breaks.length;
              while (closed.length < subCount) closed.push(false);
              closed[epA.subIdx] = true;
              partA.subpath_closed = closed;
              recompilePartPath(partA);
            } else {
              joinSubpaths(partA, epA, epB);
              recompilePartPath(partA);
            }
          } else {
            // 다른 part — B 의 anchors 를 A-local 좌표로 변환해 A 에 흡수, 이후 같은-part join.
            const tA = partA.transform ?? DEFAULT_TRANSFORM;
            const tB = partB.transform ?? DEFAULT_TRANSFORM;
            const importedAnchors = partB.anchors.map((anc) => transformAnchor(anc, tB, tA));
            const importedBreaks = (partB.subpath_breaks ?? []).map((br) => br + partA.anchors.length);
            const importedClosed = partB.subpath_closed ?? [];

            // 기존 A 의 서브패스 경계는 그대로, B 의 서브패스 시작점을 break 로 추가 (B 가 A 뒤에 붙음).
            const aSubCount = 1 + (partA.subpath_breaks?.length ?? 0);
            const aClosed = [...(partA.subpath_closed ?? [])];
            while (aClosed.length < aSubCount) aClosed.push(false);

            const newAnchors = [...partA.anchors, ...importedAnchors];
            const newBreaks = [...(partA.subpath_breaks ?? [])];
            // B 의 첫 anchor 가 시작이므로 break 추가.
            newBreaks.push(partA.anchors.length);
            for (const br of importedBreaks) newBreaks.push(br);
            const newClosed = [...aClosed, ...importedClosed];

            partA.anchors = newAnchors;
            partA.subpath_breaks = newBreaks.length > 0 ? newBreaks : undefined;
            partA.subpath_closed = newClosed.length > 0 ? newClosed : undefined;

            // B 의 anchorId 가 A 안에서도 동일 id 로 살아있으므로 endpoint 정보를 다시 계산.
            const epAFresh = findEndpointInfo(partA, a.anchorId);
            const epBInA = findEndpointInfo(partA, b.anchorId);
            if (!epAFresh || !epBInA) return;

            joinSubpaths(partA, epAFresh, epBInA);
            recompilePartPath(partA);

            // B 제거.
            state.sketch.parts = state.sketch.parts.filter((p) => p.id !== partB.id);
            state.selectedPartIds = state.selectedPartIds.filter((id) => id !== partB.id);
          }

          // 연결 결과로 어느 서브패스의 양 끝점이 같은 위치가 됐다면 자동으로 닫는다.
          // 사용자가 두 열린 패스를 잇고 나서 *반대편* 두 free endpoint 가 마침 일치하는
          // 케이스 — 또 한 번 연결을 클릭하지 않아도 닫힌 패스가 되도록.
          // 닫히면 anchors 인덱스가 바뀌므로 break 즉시 종료.
          {
            const subCount = 1 + (partA.subpath_breaks?.length ?? 0);
            for (let i = 0; i < subCount; i++) {
              if (closeSubpathIfCoincident(partA, i)) {
                recompilePartPath(partA);
                break;
              }
            }
          }

          // 두 anchor id 는 살아남지만 위치/연결만 바뀐 상태. 선택은 유지.
          // (자동 닫힘으로 한쪽 anchorId 가 사라졌을 수 있어 존재 여부를 확인.)
          const survivors = new Set(partA.anchors.map((an) => an.id));
          const sel: AnchorRef[] = [];
          if (survivors.has(a.anchorId)) sel.push({ partId: partA.id, anchorId: a.anchorId });
          if (survivors.has(b.anchorId)) sel.push({ partId: partA.id, anchorId: b.anchorId });
          state.selectedAnchors = sel;
          state.selectedAnchorId = sel.length > 0 ? sel[sel.length - 1]!.anchorId : null;
          if (!state.selectedPartIds.includes(partA.id)) {
            state.selectedPartIds = [partA.id];
          }
          state.sketch.updated_at = new Date().toISOString();
        }),

      trySnapCloseAtAnchors: (refs, snapEps) =>
        set((state) => {
          if (!state.sketch || refs.length === 0) return;
          // part 별로 묶어 한 번씩만 처리.
          const byPart = new Map<string, string[]>();
          for (const r of refs) {
            const arr = byPart.get(r.partId);
            if (arr) arr.push(r.anchorId);
            else byPart.set(r.partId, [r.anchorId]);
          }
          let touched = false;
          for (const [partId, anchorIds] of byPart) {
            const part = state.sketch.parts.find((p) => p.id === partId);
            if (!part) continue;
            // 같은 서브패스에 대해 두 endpoint 가 동시에 드래그 ref 에 들어 있어도 한 번만 처리.
            const handledSubpaths = new Set<number>();
            let partTouched = false;
            for (const aid of anchorIds) {
              const ep = findEndpointInfo(part, aid);
              if (!ep) continue;
              if (handledSubpaths.has(ep.subIdx)) continue;
              if (ep.e - ep.s < 3) continue; // 3 anchor 미만은 닫혀도 의미 없음.

              const draggedIdx = ep.anchorIdx;
              const otherIdx = ep.position === 'end' ? ep.s : ep.e - 1;
              if (draggedIdx === otherIdx) continue;
              const dragged = part.anchors[draggedIdx]!;
              const other = part.anchors[otherIdx]!;
              const dist = Math.hypot(dragged.x - other.x, dragged.y - other.y);
              if (dist > snapEps) continue;

              // 정확한 일치 위치로 스냅 — handles 도 같은 delta 로 이동해 모양 유지.
              const dx = other.x - dragged.x;
              const dy = other.y - dragged.y;
              if (dx !== 0 || dy !== 0) {
                dragged.x = other.x;
                dragged.y = other.y;
                if (dragged.handle_in) {
                  dragged.handle_in.x += dx;
                  dragged.handle_in.y += dy;
                }
                if (dragged.handle_out) {
                  dragged.handle_out.x += dx;
                  dragged.handle_out.y += dy;
                }
              }
              handledSubpaths.add(ep.subIdx);
              if (closeSubpathIfCoincident(part, ep.subIdx, 1e-6)) {
                partTouched = true;
              }
            }
            if (partTouched) {
              recompilePartPath(part);
              touched = true;
            }
          }
          if (touched) {
            // dedupe 로 사라진 anchorId 가 selectedAnchors 에 남아있을 수 있어 정리.
            const liveAnchors = new Set<string>();
            for (const p of state.sketch.parts) for (const a of p.anchors) liveAnchors.add(a.id);
            state.selectedAnchors = state.selectedAnchors.filter((r) => liveAnchors.has(r.anchorId));
            if (state.selectedAnchorId && !liveAnchors.has(state.selectedAnchorId)) {
              state.selectedAnchorId = state.selectedAnchors.length > 0
                ? state.selectedAnchors[state.selectedAnchors.length - 1]!.anchorId
                : null;
            }
            state.sketch.updated_at = new Date().toISOString();
          }
        }),

      updatePartTransform: (id, transform) =>
        set((state) => {
          if (!state.sketch) return;
          const part = state.sketch.parts.find((p) => p.id === id);
          if (!part) return;
          part.transform = { ...transform };
          state.sketch.updated_at = new Date().toISOString();
        }),

      updatePartTransforms: (updates) =>
        set((state) => {
          if (!state.sketch || updates.length === 0) return;
          const byId = new Map(updates.map((u) => [u.id, u.transform]));
          for (const part of state.sketch.parts) {
            const t = byId.get(part.id);
            if (!t) continue;
            part.transform = { ...t };
          }
          state.sketch.updated_at = new Date().toISOString();
        }),

      updatePartStyle: (id, patch) =>
        set((state) => {
          if (!state.sketch) return;
          const part = state.sketch.parts.find((p) => p.id === id);
          if (!part) return;
          if (patch.fill !== undefined) {
            // 객체(linear/radial/pattern) 는 immer draft 가 추적할 수 있도록 plain clone.
            // stops 배열도 새 인스턴스로 — 같은 참조를 다른 part 에 공유하면 한 곳 편집이
            // 다른 part 까지 새지 않게.
            if (typeof patch.fill === 'string') {
              part.fill = patch.fill;
            } else if (patch.fill.kind === 'linear') {
              part.fill = {
                ...patch.fill,
                stops: patch.fill.stops.map((s) => ({ ...s })),
              };
            } else if (patch.fill.kind === 'radial') {
              part.fill = {
                ...patch.fill,
                stops: patch.fill.stops.map((s) => ({ ...s })),
              };
            } else {
              part.fill = { ...patch.fill };
            }
          }
          if (patch.stroke !== undefined) part.stroke = patch.stroke;
          if (patch.stroke_width !== undefined) part.stroke_width = patch.stroke_width;
          if (patch.stroke_dasharray !== undefined) {
            if (patch.stroke_dasharray === null) part.stroke_dasharray = undefined;
            else part.stroke_dasharray = [...patch.stroke_dasharray];
          }
          if (patch.stroke_linecap !== undefined) part.stroke_linecap = patch.stroke_linecap;
          state.sketch.updated_at = new Date().toISOString();
        }),

      copyStyleFromPart: (sourceId, targetIds) =>
        set((state) => {
          if (!state.sketch) return;
          const source = state.sketch.parts.find((p) => p.id === sourceId);
          if (!source) return;
          // source 의 fill 은 객체(그라디언트/패턴)일 수 있어 깊은 복제 — 같은 참조를 여러
          // target 에 공유하면 한 곳 편집이 다른 곳까지 새어나간다 (updatePartStyle 과 동일 원칙).
          const cloneFill = (): PartFill =>
            typeof source.fill === 'string'
              ? source.fill
              : (JSON.parse(JSON.stringify(source.fill)) as PartFill);

          let changed = false;
          for (const id of targetIds) {
            if (id === sourceId) continue;
            const target = state.sketch.parts.find((p) => p.id === id);
            if (!target || target.locked === true) continue;
            target.fill = cloneFill();
            target.stroke = source.stroke;
            target.stroke_width = source.stroke_width;
            target.stroke_dasharray = source.stroke_dasharray
              ? [...source.stroke_dasharray]
              : undefined;
            target.stroke_linecap = source.stroke_linecap;
            target.stroke_linejoin = source.stroke_linejoin;
            changed = true;
          }
          if (changed) state.sketch.updated_at = new Date().toISOString();
        }),

      updateAnchorPosition: (partId, anchorId, x, y) =>
        set((state) => {
          if (!state.sketch) return;
          const part = state.sketch.parts.find((p) => p.id === partId);
          if (!part) return;
          const anchor = part.anchors.find((a) => a.id === anchorId);
          if (!anchor) return;
          // 앵커가 옮겨지면 자기 핸들도 같은 delta만큼 따라가야 모양이 유지된다.
          const dx = x - anchor.x;
          const dy = y - anchor.y;
          anchor.x = x;
          anchor.y = y;
          if (anchor.handle_in) {
            anchor.handle_in.x += dx;
            anchor.handle_in.y += dy;
          }
          if (anchor.handle_out) {
            anchor.handle_out.x += dx;
            anchor.handle_out.y += dy;
          }
          recompilePartPath(part);
          state.sketch.updated_at = new Date().toISOString();
        }),

      updateHandle: (partId, anchorId, side, x, y) =>
        set((state) => {
          if (!state.sketch) return;
          const part = state.sketch.parts.find((p) => p.id === partId);
          if (!part) return;
          const anchor = part.anchors.find((a) => a.id === anchorId);
          if (!anchor) return;
          const target = { x, y };
          if (side === 'in') anchor.handle_in = target;
          else anchor.handle_out = target;

          // smooth: 반대편 핸들도 앵커 기준 정반대 방향으로 같은 길이.
          // asymmetric: 정반대 방향만 맞추고 기존 길이 보존.
          // corner: 독립.
          if (anchor.kind === 'smooth' || anchor.kind === 'asymmetric') {
            const otherSide = side === 'in' ? 'out' : 'in';
            const other = otherSide === 'in' ? anchor.handle_in : anchor.handle_out;
            const dx = anchor.x - x;
            const dy = anchor.y - y;
            if (anchor.kind === 'smooth' || !other) {
              const mirrored = { x: anchor.x + dx, y: anchor.y + dy };
              if (otherSide === 'in') anchor.handle_in = mirrored;
              else anchor.handle_out = mirrored;
            } else {
              // asymmetric: 기존 길이 유지하면서 방향만 반대로.
              const oldLen = Math.hypot(other.x - anchor.x, other.y - anchor.y);
              const dragLen = Math.hypot(dx, dy);
              if (dragLen > 1e-6) {
                const k = oldLen / dragLen;
                const mirrored = { x: anchor.x + dx * k, y: anchor.y + dy * k };
                if (otherSide === 'in') anchor.handle_in = mirrored;
                else anchor.handle_out = mirrored;
              }
            }
          }

          recompilePartPath(part);
          state.sketch.updated_at = new Date().toISOString();
        }),

      insertAnchor: (partId, fromIdx, toIdx, isClosing, t) =>
        set((state) => {
          if (!state.sketch) return;
          const part = state.sketch.parts.find((p) => p.id === partId);
          if (!part) return;
          const a0 = part.anchors[fromIdx];
          const a1 = part.anchors[toIdx];
          if (!a0 || !a1) return;

          const newId = `anchor_split_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
          let newAnchor: Anchor;

          if (a0.handle_out || a1.handle_in) {
            // De Casteljau cubic split — 양쪽 인접 cubic이 새 anchor의 handle과 부드럽게 이어진다.
            const h1 = a0.handle_out ?? { x: a0.x, y: a0.y };
            const h2 = a1.handle_in ?? { x: a1.x, y: a1.y };
            const Q0 = { x: a0.x + (h1.x - a0.x) * t, y: a0.y + (h1.y - a0.y) * t };
            const Q1 = { x: h1.x + (h2.x - h1.x) * t, y: h1.y + (h2.y - h1.y) * t };
            const Q2 = { x: h2.x + (a1.x - h2.x) * t, y: h2.y + (a1.y - h2.y) * t };
            const R0 = { x: Q0.x + (Q1.x - Q0.x) * t, y: Q0.y + (Q1.y - Q0.y) * t };
            const R1 = { x: Q1.x + (Q2.x - Q1.x) * t, y: Q1.y + (Q2.y - Q1.y) * t };
            const S = { x: R0.x + (R1.x - R0.x) * t, y: R0.y + (R1.y - R0.y) * t };
            a0.handle_out = Q0;
            a1.handle_in = Q2;
            newAnchor = {
              id: newId,
              x: S.x,
              y: S.y,
              type: 'edit_point',
              kind: 'smooth',
              handle_in: R0,
              handle_out: R1,
            };
          } else {
            // 직선 세그먼트: 단순히 두 anchor를 lerp.
            newAnchor = {
              id: newId,
              x: a0.x + (a1.x - a0.x) * t,
              y: a0.y + (a1.y - a0.y) * t,
              type: 'edit_point',
              kind: 'corner',
            };
          }

          // 삽입 위치는 "from 다음" — 닫는 세그먼트(서브패스 끝→시작)도 동일하게 from+1에 끼워넣으면
          // 같은 서브패스 끝에 추가되어 Z 직전에 위치하게 된다.
          const spliceAt = fromIdx + 1;
          part.anchors.splice(spliceAt, 0, newAnchor);
          if (part.subpath_breaks) {
            part.subpath_breaks = part.subpath_breaks.map((b) => (b >= spliceAt ? b + 1 : b));
          }

          recompilePartPath(part);
          state.selectedAnchorId = newId;
          state.sketch.updated_at = new Date().toISOString();
          // isClosing은 현재 데이터에 영향 없음 (spliceAt 위치가 동일). 호출 시그니처로만 남겨두어
          // 디버그 가독성/추후 다른 분기 확장 여지를 둔다.
          void isClosing;
        }),

      deleteAnchor: (partId, anchorId) =>
        set((state) => {
          if (!state.sketch) return;
          const part = state.sketch.parts.find((p) => p.id === partId);
          if (!part) return;
          const idx = part.anchors.findIndex((a) => a.id === anchorId);
          if (idx === -1) return;

          // 어느 서브패스에 속하는지 — start..end 범위 검색.
          const breaks = part.subpath_breaks ?? [];
          const closed = part.subpath_closed ?? [];
          const starts = [0, ...breaks];
          const ranges = starts.map((s, i) => {
            const e = i + 1 < starts.length ? starts[i + 1] : part.anchors.length;
            return [s, e] as [number, number];
          });
          const subIdx = ranges.findIndex(([s, e]) => s <= idx && idx < e);
          if (subIdx === -1) return;
          const [s, e] = ranges[subIdx]!;
          const subLen = e - s;

          if (subLen <= 1) {
            // 서브패스가 통째로 사라진다. break/closed 엔트리도 같이 정리.
            part.anchors.splice(idx, 1);
            const newBreaks = [...breaks];
            const newClosed = [...closed];
            if (subIdx === 0) {
              if (newBreaks.length > 0) newBreaks.shift();
              if (newClosed.length > 0) newClosed.shift();
            } else {
              newBreaks.splice(subIdx - 1, 1);
              if (subIdx < newClosed.length) newClosed.splice(subIdx, 1);
            }
            // idx 이후의 break은 -1.
            for (let i = 0; i < newBreaks.length; i++) {
              if (newBreaks[i]! > idx) newBreaks[i] = newBreaks[i]! - 1;
            }
            part.subpath_breaks = newBreaks.length > 0 ? newBreaks : undefined;
            part.subpath_closed = newClosed.length > 0 ? newClosed : undefined;
          } else {
            part.anchors.splice(idx, 1);
            const newBreaks = breaks.map((b) => (b > idx ? b - 1 : b));
            part.subpath_breaks = newBreaks.length > 0 ? newBreaks : undefined;
          }

          recompilePartPath(part);
          state.selectedAnchorId = null;
          state.sketch.updated_at = new Date().toISOString();
        }),

      createPenPart: (initial) => {
        let createdId: string | null = null;
        set((state) => {
          if (!state.sketch) return;
          const newId = `part_pen_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
          const maxZ = state.sketch.parts.reduce((m, p) => (p.z_index > m ? p.z_index : m), 0);
          const anchor: Anchor = {
            id: `${newId}_a0`,
            x: initial.x,
            y: initial.y,
            type: 'edit_point',
            kind: initial.handle_out ? 'smooth' : 'corner',
            handle_out: initial.handle_out,
            handle_in: initial.handle_out
              ? { x: 2 * initial.x - initial.handle_out.x, y: 2 * initial.y - initial.handle_out.y }
              : undefined,
          };
          state.sketch.parts.push({
            id: newId,
            category: 'other',
            svg_paths: [],
            fill: 'none',
            stroke: '#000000',
            stroke_width: 1.5,
            anchors: [anchor],
            subpath_breaks: undefined,
            subpath_closed: [false],
            bounding_box: { x: initial.x, y: initial.y, width: 0, height: 0 },
            z_index: maxZ + 1,
            editable: true,
            swappable: true,
            transform: { ...DEFAULT_TRANSFORM },
            metadata: {},
          });
          state.selectedPartIds = [newId];
          state.selectedAnchorId = anchor.id;
          state.sketch.updated_at = new Date().toISOString();
          createdId = newId;
        });
        return createdId;
      },

      appendAnchorToPart: (partId, anchor) =>
        set((state) => {
          if (!state.sketch) return;
          const part = state.sketch.parts.find((p) => p.id === partId);
          if (!part) return;
          const newId = `${partId}_a${part.anchors.length}`;
          const next: Anchor = {
            id: newId,
            x: anchor.x,
            y: anchor.y,
            type: 'edit_point',
            kind: anchor.handle_out || anchor.handle_in ? 'smooth' : 'corner',
            handle_in: anchor.handle_in,
            handle_out: anchor.handle_out,
          };
          part.anchors.push(next);
          recompilePartPath(part);
          state.selectedAnchorId = newId;
          state.sketch.updated_at = new Date().toISOString();
        }),

      resumePenAtAnchor: (partId, anchorId) => {
        let resumedId: string | null = null;
        set((state) => {
          if (!state.sketch) return;
          const part = state.sketch.parts.find((p) => p.id === partId);
          if (!part) return;
          // 잠금/숨김/비편집 파트는 이어그리기 불가.
          if (part.locked === true || part.visible === false || part.editable === false) return;
          // 닫힌 서브패스이거나 끝점이 아니면 이어그리기 불가 (findEndpointInfo 가 null).
          const ep = findEndpointInfo(part, anchorId);
          if (!ep) return;

          const breaks = part.subpath_breaks ?? [];
          const closedArr = part.subpath_closed ?? [];
          const starts = [0, ...breaks];
          const ranges = starts.map((s, i) => {
            const e = i + 1 < starts.length ? starts[i + 1]! : part.anchors.length;
            return [s, e] as [number, number];
          });

          // 서브패스별 anchor 묶음 + 닫힘 플래그.
          const groups = ranges.map(([s, e]) => part.anchors.slice(s, e));
          const groupClosed = ranges.map((_, i) => closedArr[i] === true);

          const target = ep.subIdx;
          // 클릭한 끝점이 서브패스의 '시작'이면 뒤집어 '끝'으로 만든다.
          // (이어그리기는 항상 anchors 배열 끝에 append 하므로.)
          if (ep.position === 'start' && groups[target]!.length > 1) {
            groups[target] = reverseSubpath(groups[target]!);
          }

          // 대상 서브패스를 맨 뒤로 재배치 (나머지는 순서 유지). 대상은 반드시 열림.
          // 서브패스끼리는 독립 'M...' 으로 컴파일되므로 stroke 패스의 외형은 불변.
          const orderedGroups: Anchor[][] = [];
          const orderedClosed: boolean[] = [];
          for (let i = 0; i < groups.length; i++) {
            if (i === target) continue;
            orderedGroups.push(groups[i]!);
            orderedClosed.push(groupClosed[i]!);
          }
          orderedGroups.push(groups[target]!);
          orderedClosed.push(false);

          // 평탄화 + subpath_breaks 재계산.
          const flat: Anchor[] = [];
          const newBreaks: number[] = [];
          orderedGroups.forEach((grp, i) => {
            if (i > 0) newBreaks.push(flat.length);
            for (const a of grp) flat.push(a);
          });

          part.anchors = flat;
          part.subpath_breaks = newBreaks.length > 0 ? newBreaks : undefined;
          part.subpath_closed = orderedClosed;
          recompilePartPath(part);

          state.selectedPartIds = [part.id];
          state.selectedAnchorId = flat.length > 0 ? flat[flat.length - 1]!.id : null;
          state.selectedAnchors = [];
          state.sketch.updated_at = new Date().toISOString();
          resumedId = part.id;
        });
        return resumedId;
      },

      setLastAnchorHandleOut: (partId, handle_out, mirrorIn) =>
        set((state) => {
          if (!state.sketch) return;
          const part = state.sketch.parts.find((p) => p.id === partId);
          if (!part || part.anchors.length === 0) return;
          const last = part.anchors[part.anchors.length - 1]!;
          last.handle_out = { ...handle_out };
          if (mirrorIn) {
            last.handle_in = { x: 2 * last.x - handle_out.x, y: 2 * last.y - handle_out.y };
            last.kind = 'smooth';
          }
          recompilePartPath(part);
          state.sketch.updated_at = new Date().toISOString();
        }),

      closeLastSubpath: (partId) =>
        set((state) => {
          if (!state.sketch) return;
          const part = state.sketch.parts.find((p) => p.id === partId);
          if (!part) return;
          const breaks = part.subpath_breaks ?? [];
          const closed = [...(part.subpath_closed ?? [])];
          const subCount = 1 + breaks.length;
          // 마지막 서브패스가 닫힘 상태가 되도록 길이를 맞추고 마지막 슬롯을 true로.
          while (closed.length < subCount) closed.push(false);
          closed[subCount - 1] = true;
          part.subpath_closed = closed;
          recompilePartPath(part);
          state.sketch.updated_at = new Date().toISOString();
        }),

      setAnchorKind: (partId, anchorId, kind) =>
        set((state) => {
          if (!state.sketch) return;
          const part = state.sketch.parts.find((p) => p.id === partId);
          if (!part) return;
          const anchor = part.anchors.find((a) => a.id === anchorId);
          if (!anchor) return;
          anchor.kind = kind;
          // smooth로 바꿀 때 핸들이 둘 다 있으면 한쪽 방향으로 강제 정렬 (handle_out 기준).
          // 한쪽만 있으면 반대편을 미러링해서 생성.
          if (kind === 'smooth') {
            if (anchor.handle_out) {
              const dx = anchor.x - anchor.handle_out.x;
              const dy = anchor.y - anchor.handle_out.y;
              anchor.handle_in = { x: anchor.x + dx, y: anchor.y + dy };
            } else if (anchor.handle_in) {
              const dx = anchor.x - anchor.handle_in.x;
              const dy = anchor.y - anchor.handle_in.y;
              anchor.handle_out = { x: anchor.x + dx, y: anchor.y + dy };
            }
          }
          recompilePartPath(part);
          state.sketch.updated_at = new Date().toISOString();
        }),

      duplicateParts: (ids) =>
        set((state) => {
          if (!state.sketch || ids.length === 0) return;
          const parts = state.sketch.parts;
          const maxZ = parts.reduce((m, p) => (p.z_index > m ? p.z_index : m), 0);
          const newIds: string[] = [];
          let zCursor = maxZ + 1;

          for (const id of ids) {
            const original = parts.find((p) => p.id === id);
            if (!original) continue;
            const clone: Part = JSON.parse(JSON.stringify(original));
            clone.id = `${original.id}_copy_${Date.now().toString(36)}_${newIds.length}`;
            clone.z_index = zCursor;
            // 살짝 오프셋해서 시각적으로 구분.
            clone.transform = {
              ...(clone.transform ?? DEFAULT_TRANSFORM),
              x: (clone.transform?.x ?? 0) + 12,
              y: (clone.transform?.y ?? 0) + 12,
            };
            parts.push(clone);
            newIds.push(clone.id);
            zCursor += 1;
          }

          if (newIds.length > 0) {
            state.selectedPartIds = newIds;
            state.sketch.updated_at = new Date().toISOString();
          }
        }),

      deleteParts: (ids) =>
        set((state) => {
          if (!state.sketch || ids.length === 0) return;
          const idSet = new Set(ids);
          state.sketch.parts = state.sketch.parts.filter((p) => !idSet.has(p.id));
          state.selectedPartIds = state.selectedPartIds.filter((id) => !idSet.has(id));
          state.selectedAnchorId = null;
          state.sketch.updated_at = new Date().toISOString();
        }),

      flipPartsHorizontal: (ids) =>
        set((state) => {
          if (!state.sketch || ids.length === 0) return;
          const idSet = new Set(ids);
          const targets = state.sketch.parts.filter((p) => idSet.has(p.id));
          if (targets.length === 0) return;
          // 선택 전체의 world bbox 중심을 고정점으로 삼아 그룹 단위로 반전한다.
          // 각 파트 bbox 중심으로 잡으면 모든 파트가 제자리에서만 뒤집혀 배치가 그대로 유지됨.
          const unionX = unionWorldXRange(targets);
          const Gx = (unionX.min + unionX.max) / 2;
          for (const part of targets) {
            const t = part.transform ?? DEFAULT_TRANSFORM;
            const sx = t.scaleX || 1;
            // wx' = 2*Gx - wx ⇒ sx' = -sx, tx' = 2*Gx - tx
            part.transform = { ...t, scaleX: -sx, x: 2 * Gx - t.x };
          }
          state.sketch.updated_at = new Date().toISOString();
        }),

      flipPartsVertical: (ids) =>
        set((state) => {
          if (!state.sketch || ids.length === 0) return;
          const idSet = new Set(ids);
          const targets = state.sketch.parts.filter((p) => idSet.has(p.id));
          if (targets.length === 0) return;
          const unionY = unionWorldYRange(targets);
          const Gy = (unionY.min + unionY.max) / 2;
          for (const part of targets) {
            const t = part.transform ?? DEFAULT_TRANSFORM;
            const sy = t.scaleY || 1;
            part.transform = { ...t, scaleY: -sy, y: 2 * Gy - t.y };
          }
          state.sketch.updated_at = new Date().toISOString();
        }),

      bringToFront: (ids) =>
        set((state) => {
          if (!state.sketch || ids.length === 0) return;
          const idSet = new Set(ids);
          const parts = state.sketch.parts;
          const maxZ = parts.reduce((m, p) => (p.z_index > m ? p.z_index : m), 0);
          // 기존 z_index 오름차순으로 정렬해 상대 순서를 보존하면서 최대 z 위로 쌓는다.
          const targets = parts
            .filter((p) => idSet.has(p.id))
            .sort((a, b) => a.z_index - b.z_index);
          targets.forEach((p, i) => {
            p.z_index = maxZ + 1 + i;
          });
          state.sketch.updated_at = new Date().toISOString();
        }),

      sendToBack: (ids) =>
        set((state) => {
          if (!state.sketch || ids.length === 0) return;
          const idSet = new Set(ids);
          const parts = state.sketch.parts;
          const minZ = parts.reduce((m, p) => (p.z_index < m ? p.z_index : m), 0);
          const targets = parts
            .filter((p) => idSet.has(p.id))
            .sort((a, b) => a.z_index - b.z_index);
          // n - 1 - i 만큼 빼서 마지막 타겟이 가장 아래로 가도록(상대 순서 유지).
          targets.forEach((p, i) => {
            p.z_index = minZ - (targets.length - i);
          });
          state.sketch.updated_at = new Date().toISOString();
        }),

      toggleVisibility: (ids) =>
        set((state) => {
          if (!state.sketch || ids.length === 0) return;
          const idSet = new Set(ids);
          // 선택 중 하나라도 숨김이면 전체 표시로 — 일관된 결과를 보장.
          const anyHidden = state.sketch.parts.some(
            (p) => idSet.has(p.id) && p.visible === false,
          );
          const target = anyHidden ? true : false;
          for (const part of state.sketch.parts) {
            if (!idSet.has(part.id)) continue;
            part.visible = target;
          }
          state.sketch.updated_at = new Date().toISOString();
        }),

      toggleLock: (ids) =>
        set((state) => {
          if (!state.sketch || ids.length === 0) return;
          const idSet = new Set(ids);
          // 하나라도 잠겨있으면 전체 해제, 모두 풀려있으면 전체 잠금.
          const anyLocked = state.sketch.parts.some(
            (p) => idSet.has(p.id) && p.locked === true,
          );
          const target = anyLocked ? false : true;
          for (const part of state.sketch.parts) {
            if (!idSet.has(part.id)) continue;
            part.locked = target;
          }
          state.sketch.updated_at = new Date().toISOString();
        }),

      createRectPart: (rect) => {
        let createdId: string | null = null;
        set((state) => {
          if (!state.sketch) return;
          const w = Math.max(1, rect.width);
          const h = Math.max(1, rect.height);
          const x = rect.x;
          const y = rect.y;
          const id = `part_rect_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
          const maxZ = state.sketch.parts.reduce((m, p) => (p.z_index > m ? p.z_index : m), 0);
          // 4 corner anchors — 시계방향 (TL → TR → BR → BL). 닫힘.
          const anchors: Anchor[] = [
            { id: `${id}_a0`, x, y, type: 'edit_point', kind: 'corner' },
            { id: `${id}_a1`, x: x + w, y, type: 'edit_point', kind: 'corner' },
            { id: `${id}_a2`, x: x + w, y: y + h, type: 'edit_point', kind: 'corner' },
            { id: `${id}_a3`, x, y: y + h, type: 'edit_point', kind: 'corner' },
          ];
          state.sketch.parts.push({
            id,
            category: 'other',
            svg_paths: [],
            fill: 'none',
            stroke: '#000000',
            stroke_width: 1.5,
            anchors,
            subpath_breaks: undefined,
            subpath_closed: [true],
            bounding_box: { x, y, width: w, height: h },
            z_index: maxZ + 1,
            editable: true,
            swappable: true,
            transform: { ...DEFAULT_TRANSFORM },
            metadata: {},
          });
          // 신규 part는 anchors → svg_paths 컴파일 필요.
          const part = state.sketch.parts[state.sketch.parts.length - 1]!;
          recompilePartPath(part);
          state.selectedPartIds = [id];
          state.selectedAnchorId = null;
          state.selectedArtboardId = null;
          state.sketch.updated_at = new Date().toISOString();
          createdId = id;
        });
        return createdId;
      },

      createEllipsePart: (rect) => {
        let createdId: string | null = null;
        set((state) => {
          if (!state.sketch) return;
          const w = Math.max(1, rect.width);
          const h = Math.max(1, rect.height);
          const x = rect.x;
          const y = rect.y;
          const id = `part_ellipse_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
          const maxZ = state.sketch.parts.reduce((m, p) => (p.z_index > m ? p.z_index : m), 0);
          // 4-앵커 cubic으로 원 근사. 핸들 길이는 반지름 × KAPPA.
          const cx = x + w / 2;
          const cy = y + h / 2;
          const rx = w / 2;
          const ry = h / 2;
          const KAPPA = 0.5522847498307936;
          const ox = rx * KAPPA;
          const oy = ry * KAPPA;
          // top, right, bottom, left — 시계방향 + smooth 핸들.
          const anchors: Anchor[] = [
            {
              id: `${id}_a0`,
              x: cx,
              y: cy - ry,
              type: 'edit_point',
              kind: 'smooth',
              handle_in: { x: cx - ox, y: cy - ry },
              handle_out: { x: cx + ox, y: cy - ry },
            },
            {
              id: `${id}_a1`,
              x: cx + rx,
              y: cy,
              type: 'edit_point',
              kind: 'smooth',
              handle_in: { x: cx + rx, y: cy - oy },
              handle_out: { x: cx + rx, y: cy + oy },
            },
            {
              id: `${id}_a2`,
              x: cx,
              y: cy + ry,
              type: 'edit_point',
              kind: 'smooth',
              handle_in: { x: cx + ox, y: cy + ry },
              handle_out: { x: cx - ox, y: cy + ry },
            },
            {
              id: `${id}_a3`,
              x: cx - rx,
              y: cy,
              type: 'edit_point',
              kind: 'smooth',
              handle_in: { x: cx - rx, y: cy + oy },
              handle_out: { x: cx - rx, y: cy - oy },
            },
          ];
          state.sketch.parts.push({
            id,
            category: 'other',
            svg_paths: [],
            fill: 'none',
            stroke: '#000000',
            stroke_width: 1.5,
            anchors,
            subpath_breaks: undefined,
            subpath_closed: [true],
            bounding_box: { x, y, width: w, height: h },
            z_index: maxZ + 1,
            editable: true,
            swappable: true,
            transform: { ...DEFAULT_TRANSFORM },
            metadata: {},
          });
          const part = state.sketch.parts[state.sketch.parts.length - 1]!;
          recompilePartPath(part);
          state.selectedPartIds = [id];
          state.selectedAnchorId = null;
          state.selectedArtboardId = null;
          state.sketch.updated_at = new Date().toISOString();
          createdId = id;
        });
        return createdId;
      },

      alignParts: (action) =>
        set((state) => {
          if (!state.sketch) return;
          const ids = state.selectedPartIds;
          if (ids.length < 2) return;
          const parts = state.sketch.parts.filter((p) => ids.includes(p.id));
          if (parts.length < 2) return;

          // 각 파트의 world bbox (rotation 무시 — scale + translate만 반영).
          // bounding_box는 path-로컬 좌표라 transform을 곱해 world로 환산.
          const worldBoxes = parts.map((p) => {
            const t = p.transform ?? DEFAULT_TRANSFORM;
            const sx = Math.abs(t.scaleX || 1);
            const sy = Math.abs(t.scaleY || 1);
            const wx = p.bounding_box.x * sx + t.x;
            const wy = p.bounding_box.y * sy + t.y;
            const ww = p.bounding_box.width * sx;
            const wh = p.bounding_box.height * sy;
            return { id: p.id, x: wx, y: wy, w: ww, h: wh };
          });

          if (action === 'distribute-h' || action === 'distribute-v') {
            if (parts.length < 3) return;
            const isH = action === 'distribute-h';
            // 중심 기준 균등 분배. 양 끝 두 파트는 고정.
            const sorted = [...worldBoxes].sort((a, b) =>
              isH ? a.x + a.w / 2 - (b.x + b.w / 2) : a.y + a.h / 2 - (b.y + b.h / 2),
            );
            const first = sorted[0]!;
            const last = sorted[sorted.length - 1]!;
            const startCenter = isH ? first.x + first.w / 2 : first.y + first.h / 2;
            const endCenter = isH ? last.x + last.w / 2 : last.y + last.h / 2;
            const step = (endCenter - startCenter) / (sorted.length - 1);
            sorted.forEach((box, i) => {
              if (i === 0 || i === sorted.length - 1) return;
              const targetCenter = startCenter + step * i;
              const part = state.sketch!.parts.find((p) => p.id === box.id);
              if (!part) return;
              const t = part.transform ?? DEFAULT_TRANSFORM;
              const currentCenter = isH ? box.x + box.w / 2 : box.y + box.h / 2;
              const delta = targetCenter - currentCenter;
              part.transform = isH
                ? { ...t, x: t.x + delta }
                : { ...t, y: t.y + delta };
            });
            state.sketch.updated_at = new Date().toISOString();
            return;
          }

          // 정렬 기준선 계산.
          const xs = worldBoxes.map((b) => b.x);
          const ys = worldBoxes.map((b) => b.y);
          const rights = worldBoxes.map((b) => b.x + b.w);
          const bottoms = worldBoxes.map((b) => b.y + b.h);
          const left = Math.min(...xs);
          const right = Math.max(...rights);
          const top = Math.min(...ys);
          const bottom = Math.max(...bottoms);
          const cx = (left + right) / 2;
          const cy = (top + bottom) / 2;

          for (const box of worldBoxes) {
            const part = state.sketch.parts.find((p) => p.id === box.id);
            if (!part) continue;
            const t = part.transform ?? DEFAULT_TRANSFORM;
            let dx = 0;
            let dy = 0;
            if (action === 'align-left') dx = left - box.x;
            else if (action === 'align-right') dx = right - (box.x + box.w);
            else if (action === 'align-center-h') dx = cx - (box.x + box.w / 2);
            else if (action === 'align-top') dy = top - box.y;
            else if (action === 'align-bottom') dy = bottom - (box.y + box.h);
            else if (action === 'align-middle-v') dy = cy - (box.y + box.h / 2);
            if (dx !== 0 || dy !== 0) {
              part.transform = { ...t, x: t.x + dx, y: t.y + dy };
            }
          }
          state.sketch.updated_at = new Date().toISOString();
        }),

      unitePaths: (ids) =>
        set((state) => {
          if (!state.sketch) return;
          const targets = state.sketch.parts
            .filter((p) => ids.includes(p.id))
            .filter(hasFlattenableArea);
          if (targets.length < 2) return;

          const polygons = targets.map(partToWorldMultiPolygon).filter((mp) => mp.length > 0);
          if (polygons.length < 2) return;

          let result: MultiPolygon;
          try {
            const [first, ...rest] = polygons as [MultiPolygon, ...MultiPolygon[]];
            result = polygonClipping.union(first, ...rest);
          } catch (err) {
            console.warn('[unitePaths] polygon-clipping union 실패', err);
            return;
          }
          if (result.length === 0) return;

          // z_index 가 가장 위인 입력 파트를 스타일 템플릿으로 사용 — 일러스트레이터와 동일.
          const top = [...targets].sort((a, b) => b.z_index - a.z_index)[0]!;
          const baseZ = top.z_index;
          const newParts = multiPolygonToParts(result, top, baseZ, 'unite');
          if (newParts.length === 0) return;

          const dropSet = new Set(targets.map((p) => p.id));
          state.sketch.parts = state.sketch.parts.filter((p) => !dropSet.has(p.id));
          for (const np of newParts) state.sketch.parts.push(np);
          state.selectedPartIds = newParts.map((p) => p.id);
          state.selectedAnchorId = null;
          state.selectedAnchors = [];
          state.sketch.updated_at = new Date().toISOString();
        }),

      dividePaths: (ids) =>
        set((state) => {
          if (!state.sketch) return;
          const selected = state.sketch.parts.filter((p) => ids.includes(p.id));
          if (selected.length < 2) return;

          // Region (닫힌 영역) 과 knife (펜으로 그린 열린 path) 를 분리.
          // region 들끼리는 paper.js boolean 으로 누적 분할 — cubic 핸들 보존.
          // knife 가 섞이면 region 결과 piece 들을 칼로 추가 슬라이스.
          const regions = selected.filter(isRegionPart);
          const knives = selected.filter((p) => isKnifePart(p) && !isRegionPart(p));

          if (regions.length === 0) return;
          if (regions.length < 2 && knives.length === 0) return;

          // z_index 오름차순 — 위에 있는 파트가 나중에 처리되어 겹침 영역이 위쪽 스타일을 가져가도록.
          const sortedRegions = [...regions].sort((a, b) => a.z_index - b.z_index);

          // 누적 분할: 각 조각은 (paper.PathItem geometry, source part) 쌍.
          // 새 입력이 들어오면 기존 조각마다 (조각 ∩ 새것, 조각 − 새것) 로 쪼개고
          // 새것 − 기존 전체 합집합 = 잔여 영역.
          type Piece = { item: paper.PathItem; source: Part };
          let pieces: Piece[] = [];
          const firstItem = partToPaperItem(sortedRegions[0]!);
          if (firstItem) pieces.push({ item: firstItem, source: sortedRegions[0]! });

          for (let i = 1; i < sortedRegions.length; i++) {
            const sourceX = sortedRegions[i]!;
            const X = partToPaperItem(sourceX);
            if (!X) continue;

            const next: Piece[] = [];
            let unionSoFar: paper.PathItem | null = null;

            for (const piece of pieces) {
              try {
                const inter = piece.item.intersect(X, { insert: false }) as paper.PathItem | null;
                if (isMeaningful(inter)) {
                  // 겹침 영역은 위쪽 파트(=새 입력 X) 스타일.
                  next.push({ item: inter!, source: sourceX });
                } else {
                  disposePaperItem(inter);
                }
                const diff = piece.item.subtract(X, { insert: false }) as paper.PathItem | null;
                if (isMeaningful(diff)) {
                  next.push({ item: diff!, source: piece.source });
                } else {
                  disposePaperItem(diff);
                }
              } catch (err) {
                console.warn('[dividePaths] piece 분할 실패 — 원형 보존', err);
                next.push(piece);
                continue;
              }
              try {
                let merged: paper.PathItem;
                if (unionSoFar) {
                  merged = unionSoFar.unite(piece.item, { insert: false }) as paper.PathItem;
                  disposePaperItem(unionSoFar);
                } else {
                  merged = piece.item.clone({ insert: false }) as paper.PathItem;
                }
                unionSoFar = merged;
              } catch (err) {
                console.warn('[dividePaths] 누적 union 실패', err);
              }
              // 원본 piece.item 은 inter/diff 모두 새 PathItem 으로 next 에 옮겨졌으므로 정리.
              disposePaperItem(piece.item);
            }

            try {
              const leftover = unionSoFar
                ? (X.subtract(unionSoFar, { insert: false }) as paper.PathItem)
                : (X.clone({ insert: false }) as paper.PathItem);
              if (isMeaningful(leftover)) {
                next.push({ item: leftover, source: sourceX });
              } else {
                disposePaperItem(leftover);
              }
            } catch (err) {
              console.warn('[dividePaths] leftover 계산 실패', err);
              next.push({ item: X.clone({ insert: false }) as paper.PathItem, source: sourceX });
            }

            disposePaperItem(unionSoFar);
            disposePaperItem(X);
            pieces = next;
          }

          // Knife 슬라이스 — region 전체 bbox 기준으로 양 끝 연장(pad) 을 정해 칼이 모든 region 을 가로지르게.
          if (knives.length > 0 && pieces.length > 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const r of regions) {
              const bb = r.bounding_box;
              if (!bb) continue;
              if (bb.x < minX) minX = bb.x;
              if (bb.y < minY) minY = bb.y;
              if (bb.x + bb.width > maxX) maxX = bb.x + bb.width;
              if (bb.y + bb.height > maxY) maxY = bb.y + bb.height;
            }
            const span = Number.isFinite(maxX - minX) && Number.isFinite(maxY - minY)
              ? Math.max(maxX - minX, maxY - minY)
              : 1000;
            const pad = Math.max(span, 100) + 50;
            const halfWidth = 0.01;

            for (const knife of knives) {
              const knifeItem = knifeToPaperItem(knife, pad, halfWidth);
              if (!knifeItem) continue;
              const next: Piece[] = [];
              for (const piece of pieces) {
                try {
                  const cut = piece.item.subtract(knifeItem, { insert: false }) as paper.PathItem | null;
                  if (!isMeaningful(cut)) {
                    // 칼이 piece 를 통째로 덮어버린 비정상 케이스 — 원형 보존.
                    disposePaperItem(cut);
                    next.push(piece);
                    continue;
                  }
                  // CompoundPath 의 disjoint 영역들을 별개 piece 로 분리.
                  if (cut instanceof paper.CompoundPath) {
                    const groups = paperItemToPieces(cut);
                    for (const grp of groups) {
                      // 각 group 을 새 CompoundPath 로 묶어 한 piece 로.
                      const pieceCp = new paper.CompoundPath({ insert: false });
                      for (const sub of grp) pieceCp.addChild(sub.clone({ insert: false }));
                      next.push({ item: pieceCp, source: piece.source });
                    }
                    disposePaperItem(cut);
                  } else {
                    next.push({ item: cut!, source: piece.source });
                  }
                  disposePaperItem(piece.item);
                } catch (err) {
                  console.warn('[dividePaths] knife 슬라이스 실패 — 원형 보존', err);
                  next.push(piece);
                }
              }
              disposePaperItem(knifeItem);
              pieces = next;
            }
          }

          if (pieces.length === 0) return;

          // 결과 PathItem 들을 piece (outer + holes) 단위로 분해 후 Anchor 기반 Part 로.
          const baseZ = selected.reduce((m, p) => (p.z_index > m ? p.z_index : m), 0);
          const newParts: Part[] = [];
          let zCursor = baseZ;
          for (const piece of pieces) {
            const groups = paperItemToPieces(piece.item);
            for (let gi = 0; gi < groups.length; gi++) {
              zCursor += 1;
              const np = pieceToPart(groups[gi]!, piece.source, zCursor, 'divide', newParts.length);
              if (np) newParts.push(np);
            }
            disposePaperItem(piece.item);
          }
          if (newParts.length === 0) return;

          // 일러스트 Pathfinder 분할: 결과 조각들을 단일 그룹으로 묶어 사용자가
          // 한 단위로 옮기고/지우기 쉽게 만든다. 조각이 1개면 그룹 의미 없음.
          if (newParts.length >= 2) {
            const groupId = `group_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
            for (const np of newParts) np.group_id = groupId;
          }

          // svg_paths 컴파일 (recompilePartPath 는 anchors 기반으로 d 를 새로 만든다).
          for (const np of newParts) recompilePartPath(np);

          // region 과 knife 모두 입력 — 둘 다 결과에 흡수되므로 같이 제거.
          const dropSet = new Set([...regions, ...knives].map((p) => p.id));
          state.sketch.parts = state.sketch.parts.filter((p) => !dropSet.has(p.id));
          for (const np of newParts) state.sketch.parts.push(np);
          state.selectedPartIds = newParts.map((p) => p.id);
          state.selectedAnchorId = null;
          state.selectedAnchors = [];
          state.sketch.updated_at = new Date().toISOString();
        }),

      subtractPaths: (ids) =>
        set((state) => {
          if (!state.sketch) return;
          const targets = state.sketch.parts
            .filter((p) => ids.includes(p.id))
            .filter(hasFlattenableArea);
          if (targets.length < 2) return;

          // 가장 아래 파트가 베이스 (Figma Subtract / Illustrator Minus Front 와 동일).
          const sorted = [...targets].sort((a, b) => a.z_index - b.z_index);
          const base = sorted[0]!;
          const subtractors = sorted.slice(1);
          const basePoly = partToWorldMultiPolygon(base);
          if (basePoly.length === 0) return;
          const subPolys = subtractors
            .map(partToWorldMultiPolygon)
            .filter((mp) => mp.length > 0);
          if (subPolys.length === 0) return;

          let result: MultiPolygon;
          try {
            result = polygonClipping.difference(
              basePoly,
              ...(subPolys as [MultiPolygon, ...MultiPolygon[]]),
            );
          } catch (err) {
            console.warn('[subtractPaths] difference 실패', err);
            return;
          }
          if (result.length === 0) return;

          const newParts = multiPolygonToParts(result, base, base.z_index, 'subtract');
          if (newParts.length === 0) return;

          const dropSet = new Set(targets.map((p) => p.id));
          state.sketch.parts = state.sketch.parts.filter((p) => !dropSet.has(p.id));
          for (const np of newParts) state.sketch.parts.push(np);
          state.selectedPartIds = newParts.map((p) => p.id);
          state.selectedAnchorId = null;
          state.selectedAnchors = [];
          state.sketch.updated_at = new Date().toISOString();
        }),

      intersectPaths: (ids) =>
        set((state) => {
          if (!state.sketch) return;
          const targets = state.sketch.parts
            .filter((p) => ids.includes(p.id))
            .filter(hasFlattenableArea);
          if (targets.length < 2) return;

          const polygons = targets.map(partToWorldMultiPolygon).filter((mp) => mp.length > 0);
          if (polygons.length < 2) return;

          let result: MultiPolygon;
          try {
            const [first, ...rest] = polygons as [MultiPolygon, ...MultiPolygon[]];
            result = polygonClipping.intersection(first, ...rest);
          } catch (err) {
            console.warn('[intersectPaths] intersection 실패', err);
            return;
          }
          if (result.length === 0) return;

          const top = [...targets].sort((a, b) => b.z_index - a.z_index)[0]!;
          const newParts = multiPolygonToParts(result, top, top.z_index, 'intersect');
          if (newParts.length === 0) return;

          const dropSet = new Set(targets.map((p) => p.id));
          state.sketch.parts = state.sketch.parts.filter((p) => !dropSet.has(p.id));
          for (const np of newParts) state.sketch.parts.push(np);
          state.selectedPartIds = newParts.map((p) => p.id);
          state.selectedAnchorId = null;
          state.selectedAnchors = [];
          state.sketch.updated_at = new Date().toISOString();
        }),

      excludePaths: (ids) =>
        set((state) => {
          if (!state.sketch) return;
          const targets = state.sketch.parts
            .filter((p) => ids.includes(p.id))
            .filter(hasFlattenableArea);
          if (targets.length < 2) return;

          const polygons = targets.map(partToWorldMultiPolygon).filter((mp) => mp.length > 0);
          if (polygons.length < 2) return;

          let result: MultiPolygon;
          try {
            const [first, ...rest] = polygons as [MultiPolygon, ...MultiPolygon[]];
            result = polygonClipping.xor(first, ...rest);
          } catch (err) {
            console.warn('[excludePaths] xor 실패', err);
            return;
          }
          if (result.length === 0) return;

          const top = [...targets].sort((a, b) => b.z_index - a.z_index)[0]!;
          const newParts = multiPolygonToParts(result, top, top.z_index, 'exclude');
          if (newParts.length === 0) return;

          const dropSet = new Set(targets.map((p) => p.id));
          state.sketch.parts = state.sketch.parts.filter((p) => !dropSet.has(p.id));
          for (const np of newParts) state.sketch.parts.push(np);
          state.selectedPartIds = newParts.map((p) => p.id);
          state.selectedAnchorId = null;
          state.selectedAnchors = [];
          state.sketch.updated_at = new Date().toISOString();
        }),

      groupParts: (ids) =>
        set((state) => {
          if (!state.sketch || ids.length < 2) return;
          if (!state.sketch.group_parents) state.sketch.group_parents = {};
          const sketch = state.sketch;
          const idSet = new Set(ids);
          const newGroupId = `group_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;

          // 모든 그룹 id 수집 — 파트의 group_id, group_parents 키/값 모두에서.
          const allGroupIds = new Set<string>();
          for (const p of sketch.parts) if (p.group_id) allGroupIds.add(p.group_id);
          for (const [child, parent] of Object.entries(sketch.group_parents)) {
            allGroupIds.add(child);
            if (parent) allGroupIds.add(parent);
          }

          // 그룹의 모든 후손 파트 id 캐시 — 깊은 재귀 1회로 계산.
          const descendantPartIds = new Map<string, Set<string>>();
          const computeDesc = (g: string): Set<string> => {
            const cached = descendantPartIds.get(g);
            if (cached) return cached;
            const out = new Set<string>();
            for (const p of sketch.parts) if (p.group_id === g) out.add(p.id);
            for (const [child, parent] of Object.entries(sketch.group_parents)) {
              if (parent === g) for (const id of computeDesc(child)) out.add(id);
            }
            descendantPartIds.set(g, out);
            return out;
          };

          // 후손 파트가 모두 idSet 에 포함된 그룹 = 통째로 감쌀 후보.
          const fullySelected = new Set<string>();
          for (const g of allGroupIds) {
            const d = computeDesc(g);
            if (d.size === 0) continue;
            let all = true;
            for (const id of d) if (!idSet.has(id)) { all = false; break; }
            if (all) fullySelected.add(g);
          }

          // 그 중 maximal — 부모가 fullySelected 가 아닌 것들만 → 새 그룹의 직속 자식.
          const maximalFS = new Set<string>();
          for (const g of fullySelected) {
            const parent = sketch.group_parents[g];
            if (!parent || !fullySelected.has(parent)) maximalFS.add(g);
          }

          // 그룹 단위로 감싸진 그룹들의 부모를 새 그룹으로.
          for (const g of maximalFS) sketch.group_parents[g] = newGroupId;

          // 파트는 — 자기가 속한 그룹의 조상 중 maximalFS 가 있으면 그쪽으로 이미 흡수됨.
          // 그렇지 않은 파트만 새 그룹의 직속 멤버로.
          const ancestorsOf = (g: string): string[] => {
            const chain: string[] = [];
            let cur: string | undefined = g;
            // 무한 루프 방어 — group_parents 에 사이클이 들어가지 않도록 가드.
            const seen = new Set<string>();
            while (cur && !seen.has(cur)) {
              chain.push(cur);
              seen.add(cur);
              cur = sketch.group_parents[cur];
            }
            return chain;
          };
          for (const id of idSet) {
            const part = sketch.parts.find((p) => p.id === id);
            if (!part) continue;
            if (part.group_id) {
              const chain = ancestorsOf(part.group_id);
              if (chain.some((g) => maximalFS.has(g))) continue;
            }
            part.group_id = newGroupId;
          }

          sketch.updated_at = new Date().toISOString();
        }),

      ungroupParts: (ids) =>
        set((state) => {
          if (!state.sketch || ids.length === 0) return;
          if (!state.sketch.group_parents) state.sketch.group_parents = {};
          const sketch = state.sketch;
          // ids 안의 파트가 속한 직속 그룹들을 해제. 해제 = 자식들을 한 단계 위로 끌어올림.
          const targetGroups = new Set<string>();
          for (const id of ids) {
            const part = sketch.parts.find((p) => p.id === id);
            if (part?.group_id) targetGroups.add(part.group_id);
          }
          if (targetGroups.size === 0) return;

          for (const g of targetGroups) {
            const parentOfG = sketch.group_parents[g];
            // 직속 멤버 파트 → 부모 그룹(또는 루트)으로.
            for (const part of sketch.parts) {
              if (part.group_id === g) part.group_id = parentOfG;
            }
            // 서브 그룹 → 부모 그룹(또는 루트)으로 승격.
            for (const [child, par] of Object.entries(sketch.group_parents)) {
              if (par === g) {
                if (parentOfG) sketch.group_parents[child] = parentOfG;
                else delete sketch.group_parents[child];
              }
            }
            // 그룹 자체 정리.
            delete sketch.group_parents[g];
            if (sketch.group_names && sketch.group_names[g]) delete sketch.group_names[g];
          }

          sketch.updated_at = new Date().toISOString();
        }),

      getGroupMemberIds: (partId) => {
        const sketch = get().sketch;
        if (!sketch) return [partId];
        const target = sketch.parts.find((p) => p.id === partId);
        if (!target?.group_id) return [partId];
        // 클릭은 '최외곽 그룹' 전체를 한 단위로 잡는다 (Illustrator 컨벤션).
        // svg-to-parts 는 part.group_id 에 '최내부' 그룹을 넣고 중첩은 group_parents 로
        // 표현한다. 그래서 group_id 형제만 보면 한 패스만 잡히는 경우가 생긴다(각 패스가
        // 자기만의 내부 <g> 에 들어간 경우). group_parents 를 거슬러 올라가 부모 없는 최상위
        // 조상 그룹을 찾고, 그 그룹의 모든 후손 파트를 반환한다.
        // 평면(1단계) 그룹이면 최상위 = group_id 라 기존과 동일하게 동작한다.
        const parents = sketch.group_parents ?? {};
        let top = target.group_id;
        const seen = new Set<string>();
        while (parents[top] && !seen.has(top)) {
          seen.add(top);
          top = parents[top]!;
        }
        return get().getGroupDescendantPartIds(top);
      },

      getGroupDescendantPartIds: (groupId) => {
        const sketch = get().sketch;
        if (!sketch) return [];
        const parents = sketch.group_parents ?? {};
        const out = new Set<string>();
        const visit = (g: string, seen: Set<string>) => {
          if (seen.has(g)) return;
          seen.add(g);
          for (const p of sketch.parts) if (p.group_id === g) out.add(p.id);
          for (const [child, par] of Object.entries(parents)) {
            if (par === g) visit(child, seen);
          }
        };
        visit(groupId, new Set());
        return [...out];
      },

      moveLayers: (items, target) =>
        set((state) => {
          if (!state.sketch) return;
          if (!state.sketch.group_parents) state.sketch.group_parents = {};
          const sketch = state.sketch;
          const parents = sketch.group_parents;

          // 입력 정규화 — 중복 제거, 빈 입력 가드.
          const itemKeys = new Set<string>();
          const movingItems = items.filter((it) => {
            const k = `${it.kind}:${it.id}`;
            if (itemKeys.has(k)) return false;
            itemKeys.add(k);
            return true;
          });
          if (movingItems.length === 0) return;

          // 모든 그룹 id.
          const allGroupIds = new Set<string>();
          for (const p of sketch.parts) if (p.group_id) allGroupIds.add(p.group_id);
          for (const [child, par] of Object.entries(parents)) {
            allGroupIds.add(child);
            if (par) allGroupIds.add(par);
          }

          // 그룹의 직속 부모 / 파트의 직속 부모 구하기.
          const parentOf = (it: { kind: 'part' | 'group'; id: string }): string | undefined => {
            if (it.kind === 'part') {
              return sketch.parts.find((p) => p.id === it.id)?.group_id;
            }
            return parents[it.id];
          };

          // 한 그룹의 조상 체인 (자기 자신 포함). 사이클 가드.
          const ancestorsOfGroup = (g: string): Set<string> => {
            const out = new Set<string>();
            let cur: string | undefined = g;
            while (cur && !out.has(cur)) { out.add(cur); cur = parents[cur]; }
            return out;
          };

          // 타겟 부모 그룹 + 앵커 결정.
          let targetParent: string | undefined;
          let anchor: { kind: 'part' | 'group'; id: string } | null = null;
          let position: 'before' | 'after' | 'into-end' | 'root-end' = 'root-end';
          if (target.kind === 'into-group') {
            targetParent = target.groupId;
            position = 'into-end';
          } else if (target.kind === 'root-end') {
            targetParent = undefined;
            position = 'root-end';
          } else {
            anchor = { kind: target.refKind, id: target.refId };
            targetParent = parentOf(anchor);
            position = target.kind;
          }

          // 사이클 방지 — 그룹을 자기 후손으로 이동하면 안 됨.
          if (targetParent) {
            const chain = ancestorsOfGroup(targetParent);
            for (const it of movingItems) {
              if (it.kind === 'group' && chain.has(it.id)) {
                // 자기 자신/조상 안으로 들어가는 시도 → no-op.
                return;
              }
            }
          }

          // 자기 자신을 anchor 로 한 before/after 는 의미 없음.
          if (anchor) {
            for (const it of movingItems) {
              if (it.kind === anchor.kind && it.id === anchor.id) return;
            }
          }

          // 1) 이동: 각 항목의 직속 부모를 targetParent 로 변경.
          for (const it of movingItems) {
            if (it.kind === 'part') {
              const part = sketch.parts.find((p) => p.id === it.id);
              if (!part) continue;
              part.group_id = targetParent;
            } else {
              if (targetParent) parents[it.id] = targetParent;
              else delete parents[it.id];
            }
          }

          // 2) 트리 빌드 → 평탄화 → 전체 z_index 재할당 (N..1 내림차순).
          // 각 레벨에서 children 의 정렬 키:
          //  - part: z_index
          //  - group: 후손 파트의 max z_index (없으면 -Infinity 로 맨 아래)
          // 이동 직후에는 anchor 기준 before/after 를 반영하기 위해 임시로 z_index 를 미세 조정.
          //
          // 단순화 — 우선 현재 z_index 기준으로 트리를 만든 뒤,
          // 같은 부모 안에서 anchor 옆으로 movingItems 의 순서를 끼워넣는다.
          type Node = { kind: 'part'; id: string; z: number } | { kind: 'group'; id: string; z: number; children: Node[] };

          const groupMaxZ = (g: string): number => {
            let m = -Infinity;
            for (const p of sketch.parts) {
              if (!p.group_id) continue;
              const chain = ancestorsOfGroup(p.group_id);
              if (chain.has(g) && p.z_index > m) m = p.z_index;
            }
            return m;
          };

          const buildChildren = (g: string | undefined): Node[] => {
            const partsHere = sketch.parts.filter((p) => p.group_id === g);
            const groupsHere = [...allGroupIds].filter((gid) => parents[gid] === g);
            const nodes: Node[] = [];
            for (const p of partsHere) nodes.push({ kind: 'part', id: p.id, z: p.z_index });
            for (const gid of groupsHere) {
              nodes.push({ kind: 'group', id: gid, z: groupMaxZ(gid), children: buildChildren(gid) });
            }
            // 같은 레벨에서 z 내림차순.
            nodes.sort((a, b) => b.z - a.z);
            return nodes;
          };

          const tree = buildChildren(undefined);

          // 같은 부모 안에서 anchor 옆으로 movingItems 를 끼워넣는 reorder.
          const reorderInPlace = (nodes: Node[], parentIdOpt: string | undefined) => {
            // 자식 안의 그룹들에 대해 재귀.
            for (const n of nodes) if (n.kind === 'group') reorderInPlace(n.children, n.id);
            if (parentIdOpt !== targetParent) return;
            // 이동 항목들을 현재 레벨에서 추출 (movingItems 순서 보존).
            const movingKeys = new Set(movingItems.map((it) => `${it.kind}:${it.id}`));
            const moving: Node[] = [];
            const remaining: Node[] = [];
            for (const n of nodes) {
              if (movingKeys.has(`${n.kind}:${n.id}`)) moving.push(n);
              else remaining.push(n);
            }
            if (moving.length === 0) return;
            // moving 의 순서를 movingItems 순서대로 정렬.
            moving.sort(
              (a, b) =>
                movingItems.findIndex((m) => m.kind === a.kind && m.id === a.id) -
                movingItems.findIndex((m) => m.kind === b.kind && m.id === b.id),
            );
            // 재배치.
            let idx = 0;
            if (position === 'into-end' || position === 'root-end') {
              idx = remaining.length; // 가장 아래 (panel 기준 끝).
            } else if (anchor) {
              const ai = remaining.findIndex((n) => n.kind === anchor!.kind && n.id === anchor!.id);
              if (ai < 0) idx = remaining.length;
              else idx = position === 'before' ? ai : ai + 1;
            }
            nodes.length = 0;
            for (const n of remaining.slice(0, idx)) nodes.push(n);
            for (const n of moving) nodes.push(n);
            for (const n of remaining.slice(idx)) nodes.push(n);
          };
          reorderInPlace(tree, undefined);

          // 평탄화 → z 재할당. 패널 위쪽이 z 가 높다.
          const flat: { kind: 'part' | 'group'; id: string }[] = [];
          const flatten = (nodes: Node[]) => {
            for (const n of nodes) {
              flat.push({ kind: n.kind, id: n.id });
              if (n.kind === 'group') flatten(n.children);
            }
          };
          flatten(tree);

          const partsTotal = flat.filter((f) => f.kind === 'part').length;
          let zCursor = partsTotal;
          for (const f of flat) {
            if (f.kind === 'part') {
              const part = sketch.parts.find((p) => p.id === f.id);
              if (part) part.z_index = zCursor;
              zCursor -= 1;
            }
          }

          // 빈 그룹 정리 — 후손 파트가 없는 그룹은 의미가 없으므로 제거 (group_parents/group_names).
          const aliveGroups = new Set<string>();
          for (const p of sketch.parts) if (p.group_id) aliveGroups.add(p.group_id);
          // 살아있는 그룹의 조상도 살림.
          let changed = true;
          while (changed) {
            changed = false;
            for (const g of [...aliveGroups]) {
              const par = parents[g];
              if (par && !aliveGroups.has(par)) { aliveGroups.add(par); changed = true; }
            }
          }
          for (const g of Object.keys(parents)) {
            if (!aliveGroups.has(g)) delete parents[g];
          }
          if (sketch.group_names) {
            for (const g of Object.keys(sketch.group_names)) {
              if (!aliveGroups.has(g)) delete sketch.group_names[g];
            }
          }

          sketch.updated_at = new Date().toISOString();
        }),

      renamePart: (id, name) =>
        set((state) => {
          if (!state.sketch) return;
          const part = state.sketch.parts.find((p) => p.id === id);
          if (!part) return;
          const trimmed = name.trim();
          // 빈 입력은 폴백 라벨("Vector N")로 되돌리기 위해 name 자체를 제거.
          if (trimmed.length === 0) part.name = undefined;
          else part.name = trimmed;
          state.sketch.updated_at = new Date().toISOString();
        }),

      renameGroup: (groupId, name) =>
        set((state) => {
          if (!state.sketch) return;
          // group_names 가 누락된 과거 데이터는 빈 객체로 한 번 초기화.
          if (!state.sketch.group_names) state.sketch.group_names = {};
          const trimmed = name.trim();
          if (trimmed.length === 0) {
            delete state.sketch.group_names[groupId];
          } else {
            state.sketch.group_names[groupId] = trimmed;
          }
          state.sketch.updated_at = new Date().toISOString();
        }),

      copyParts: (ids) =>
        set((state) => {
          if (!state.sketch || ids.length === 0) return;
          const idSet = new Set(ids);
          // 깊은 복사 — 이후 sketch가 바뀌어도 클립보드 스냅샷은 영향 받지 않는다.
          state.clipboardParts = state.sketch.parts
            .filter((p) => idSet.has(p.id))
            .map((p) => JSON.parse(JSON.stringify(p)) as Part);
        }),

      pasteParts: () =>
        set((state) => {
          if (!state.sketch) return;
          const clipboard = state.clipboardParts;
          if (clipboard.length === 0) return;
          const parts = state.sketch.parts;
          const maxZ = parts.reduce((m, p) => (p.z_index > m ? p.z_index : m), 0);
          const stamp = Date.now().toString(36);
          // 같은 group_id를 가진 클립보드 파트들은 paste 후에도 같은 새 그룹으로 유지.
          const groupRemap = new Map<string, string>();
          const newIds: string[] = [];
          let zCursor = maxZ + 1;
          clipboard.forEach((src, i) => {
            const clone: Part = JSON.parse(JSON.stringify(src));
            clone.id = `${src.id}_paste_${stamp}_${i}`;
            clone.z_index = zCursor++;
            clone.transform = {
              ...(clone.transform ?? DEFAULT_TRANSFORM),
              x: (clone.transform?.x ?? 0) + 12,
              y: (clone.transform?.y ?? 0) + 12,
            };
            if (clone.group_id) {
              const oldGid = clone.group_id;
              let nextGid = groupRemap.get(oldGid);
              if (!nextGid) {
                nextGid = `group_paste_${stamp}_${groupRemap.size}`;
                groupRemap.set(oldGid, nextGid);
                // 소스 그룹의 이름도 함께 복사 — 안 그러면 paste 된 그룹이 group_names 에
                // 등록 안 돼 레이어 패널에서 fallback "그룹" 으로 뜨고, 라이브러리 dump
                // (이름 기반 매칭) 에서도 잡히지 않는다 (Puff Sleeve 양쪽 캡처 회귀).
                const srcName = state.sketch!.group_names[oldGid];
                if (srcName) {
                  state.sketch!.group_names[nextGid] = srcName;
                }
              }
              clone.group_id = nextGid;
            }
            parts.push(clone);
            newIds.push(clone.id);
          });
          state.selectedPartIds = newIds;
          state.selectedAnchorId = null;
          state.selectedArtboardId = null;
          state.sketch.updated_at = new Date().toISOString();
        }),

      nudgeParts: (ids, dx, dy) =>
        set((state) => {
          if (!state.sketch || ids.length === 0) return;
          if (dx === 0 && dy === 0) return;
          const idSet = new Set(ids);
          for (const part of state.sketch.parts) {
            if (!idSet.has(part.id)) continue;
            const t = part.transform ?? DEFAULT_TRANSFORM;
            part.transform = { ...t, x: t.x + dx, y: t.y + dy };
          }
          state.sketch.updated_at = new Date().toISOString();
        }),

      createArtboard: (rect) => {
        let createdId: string | null = null;
        set((state) => {
          if (!state.sketch) return;
          const list = state.sketch.artboards ?? [];
          const id = `artboard_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
          const name = `대지${list.length + 1}`;
          const ab: Artboard = {
            id,
            name,
            x: rect.x,
            y: rect.y,
            width: Math.max(1, rect.width),
            height: Math.max(1, rect.height),
          };
          state.sketch.artboards = [...list, ab];
          state.selectedArtboardId = id;
          state.selectedPartIds = [];
          state.selectedAnchorId = null;
          state.sketch.updated_at = new Date().toISOString();
          createdId = id;
        });
        return createdId;
      },

      seedDefaultArtboardFromCanvas: () =>
        set((state) => {
          if (!state.sketch) return;
          const list = state.sketch.artboards ?? [];
          if (list.length > 0) return;
          const { width, height } = state.sketch.canvas;
          const ab: Artboard = {
            id: `artboard_${Date.now().toString(36)}_default`,
            name: '대지1',
            x: 0,
            y: 0,
            width,
            height,
          };
          state.sketch.artboards = [ab];
          state.sketch.updated_at = new Date().toISOString();
        }),

      selectArtboard: (id) =>
        set((state) => {
          state.selectedArtboardId = id;
          if (id !== null) {
            state.selectedPartIds = [];
            state.selectedAnchorId = null;
          }
        }),

      updateArtboard: (id, patch) =>
        set((state) => {
          if (!state.sketch) return;
          const list = state.sketch.artboards ?? [];
          const ab = list.find((a) => a.id === id);
          if (!ab) return;
          if (patch.name !== undefined) ab.name = patch.name;
          if (patch.x !== undefined) ab.x = patch.x;
          if (patch.y !== undefined) ab.y = patch.y;
          if (patch.width !== undefined) ab.width = Math.max(1, patch.width);
          if (patch.height !== undefined) ab.height = Math.max(1, patch.height);
          state.sketch.updated_at = new Date().toISOString();
        }),

      deleteArtboard: (id) =>
        set((state) => {
          if (!state.sketch) return;
          const list = state.sketch.artboards ?? [];
          state.sketch.artboards = list.filter((a) => a.id !== id);
          if (state.selectedArtboardId === id) state.selectedArtboardId = null;
          state.sketch.updated_at = new Date().toISOString();
        }),

      setActiveTool: (tool) =>
        set((state) => {
          state.activeTool = tool;
        }),

      setJobStatus: (status) =>
        set((state) => {
          state.jobStatus = status;
        }),

      setViewport: (v) =>
        set((state) => {
          state.viewport = v;
        }),

      setPanelMode: (mode) =>
        set((state) => {
          state.panelMode = mode;
        }),

      markSketchSynced: (sketch) =>
        set((state) => {
          state.lastSavedSketchJson = JSON.stringify(sketch);
          state.saveStatus = 'saved';
        }),

      setSaveStatus: (status) =>
        set((state) => {
          state.saveStatus = status;
        }),

      toggleHideUI: () =>
        set((state) => {
          state.hideUI = !state.hideUI;
        }),

      toggleUIMinimized: () =>
        set((state) => {
          const next = !state.uiMinimized;
          state.uiMinimized = next;
          // 좌측 패널(w-60 = 240px)이 사라지면 main의 좌측 끝이 240px 만큼 좌측으로 이동한다.
          // viewport.x는 main 컨테이너 기준이므로 그대로 두면 캔버스가 화면상 좌측으로 240px 끌려 간다.
          // 동일한 화면 위치를 유지하기 위해 minimize 시 +240, restore 시 -240 보정.
          const LEFT_PANEL_WIDTH = 240;
          state.viewport.x += next ? LEFT_PANEL_WIDTH : -LEFT_PANEL_WIDTH;
        }),

      toggleRuler: () =>
        set((state) => {
          state.showRuler = !state.showRuler;
        }),

      requestViewCommand: (cmd) =>
        set((state) => {
          state.pendingViewCommand = cmd;
        }),

      clearViewCommand: () =>
        set((state) => {
          state.pendingViewCommand = null;
        }),

      setImageInputOpen: (open) =>
        set((state) => {
          state.imageInputOpen = open;
        }),

      toggleImageInput: () =>
        set((state) => {
          state.imageInputOpen = !state.imageInputOpen;
        }),

      addLibraryAssets: (assets) =>
        set((state) => {
          const seen = new Set(state.libraryAssets.map((a) => a.id));
          for (const a of assets) {
            if (seen.has(a.id)) continue;
            state.libraryAssets.push(a);
            seen.add(a.id);
          }
        }),

      removeLibraryAsset: (id) =>
        set((state) => {
          state.libraryAssets = state.libraryAssets.filter((a) => a.id !== id);
        }),

      setPartAssetDragActive: (active) =>
        set((state) => {
          state.partAssetDragActive = active;
          if (!active) state.partAssetDropHover = false;
        }),

      setPartAssetDropHover: (hover) =>
        set((state) => {
          state.partAssetDropHover = hover;
        }),

      requestAssetFromParts: (partIds) => {
        const sketch = get().sketch;
        if (!sketch) return;
        const idSet = new Set(partIds);
        // z-order/위치를 그대로 보존하려고 원본 parts 배열 순서대로 추린다.
        const parts = sketch.parts.filter((p) => idSet.has(p.id));
        if (parts.length === 0) return;

        // export 와 동일한 직렬화기 — 각 파트의 transform 을 보존하고 viewBox 를 선택 영역
        // bbox 로 크롭한다. 결과 SVG 는 data URL 로 만들어 <img> 미리보기·재적용 fetch 모두에 쓴다.
        const { svg } = serializeSelectedPartsToSvg(parts);
        const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

        // 기본 이름 — 그룹명 > 파트의 사용자 이름 > 카테고리 > 폴백.
        let defaultName = '내 에셋';
        const groupId = parts.find((p) => p.group_id)?.group_id;
        if (groupId && sketch.group_names[groupId]) {
          defaultName = sketch.group_names[groupId];
        } else if (parts[0]?.name) {
          defaultName = parts[0].name as string;
        } else if (parts[0]?.category) {
          defaultName = parts[0].category;
        }

        set((state) => {
          state.pendingAssetDraft = { svgUrl, defaultName };
          state.partAssetDragActive = false;
          state.partAssetDropHover = false;
          // 드롭과 동시에 라이브러리 탭으로 전환해 추가 결과가 바로 보이게 한다.
          state.panelMode = 'library';
        });
      },

      cancelPendingAsset: () =>
        set((state) => {
          state.pendingAssetDraft = null;
          state.partAssetDragActive = false;
        }),

      commitPendingAsset: (name) =>
        set((state) => {
          const draft = state.pendingAssetDraft;
          if (!draft) return;
          const trimmed = name.trim() || draft.defaultName;
          const id = `myasset_${Date.now().toString(36)}_${Math.floor(
            Math.random() * 1e6,
          ).toString(36)}`;
          state.libraryAssets.push({
            id,
            name: trimmed,
            category: MY_LIBRARY_CATEGORY,
            svgUrl: draft.svgUrl,
          });
          state.pendingAssetDraft = null;
          state.partAssetDragActive = false;
          state.panelMode = 'library';
        }),

      applyLibraryAssetToCanvas: async (assetId) => {
        const asset = get().libraryAssets.find((a) => a.id === assetId);
        if (!asset) return;
        const sketch = get().sketch;
        if (!sketch) return;

        // 같은 카테고리 부위 매칭 — "크기 참조" 용도로만 쓴다. (갈아끼우기/위치 스냅은
        // 아직 미완성이라 기존 부위를 숨기거나 그 자리에 놓지 않는다.) 카테고리 그대로
        // ("Sleeve") · 별칭 ("소매" / "Sleeve (Left)" / "Sleeve (Right)") · 이전 적용으로
        // 생긴 그룹명 ("Sleeve (Puff Sleeve)") 까지 `${name} (` 프리픽스로 함께 잡는다.
        const aliases = LIBRARY_ASSET_CATEGORY_ALIASES[asset.category] ?? [];
        const groupNamePrefixes = [
          `${asset.category} (`,
          ...aliases.map((a) => `${a} (`),
        ];
        const groupNameExacts = new Set<string>([asset.category, ...aliases]);
        const matchedGroupIds: string[] = [];
        for (const [gid, gname] of Object.entries(sketch.group_names)) {
          if (sketch.group_parents[gid]) continue; // 최상위만
          if (
            groupNameExacts.has(gname) ||
            groupNamePrefixes.some((pre) => gname.startsWith(pre))
          ) {
            matchedGroupIds.push(gid);
          }
        }

        // 주어진 part id 집합의 world bbox 크기(width/height). 비어 있으면 null.
        const worldSizeOf = (
          partIds: Set<string>,
        ): { width: number; height: number } | null => {
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          let hasAny = false;
          for (const part of sketch.parts) {
            if (!partIds.has(part.id)) continue;
            const t = part.transform ?? DEFAULT_TRANSFORM;
            for (const sub of flattenPart(part)) {
              for (const pt of sub.points) {
                const w = localToWorld({ x: pt.x, y: pt.y }, t);
                if (!Number.isFinite(w.x) || !Number.isFinite(w.y)) continue;
                if (w.x < minX) minX = w.x;
                if (w.y < minY) minY = w.y;
                if (w.x > maxX) maxX = w.x;
                if (w.y > maxY) maxY = w.y;
                hasAny = true;
              }
            }
          }
          if (!hasAny) return null;
          return { width: maxX - minX, height: maxY - minY };
        };

        // 크기 기준(sizeRef) 결정:
        //   1) 같은 카테고리 부위가 있으면 그 부위들의 합쳐진 bbox 크기.
        //   2) 없으면 기존 최상위 그룹(부위)들의 중앙값 크기.
        //   3) 그래도 없으면(빈 캔버스) 캔버스 단변의 40% 정사각.
        let sizeRef: { width: number; height: number } | null = null;
        if (matchedGroupIds.length > 0) {
          const ids = new Set<string>();
          for (const gid of matchedGroupIds) {
            for (const pid of get().getGroupDescendantPartIds(gid)) ids.add(pid);
          }
          sizeRef = worldSizeOf(ids);
        }
        if (!sizeRef) {
          const sizes: { width: number; height: number }[] = [];
          for (const gid of Object.keys(sketch.group_names)) {
            if (sketch.group_parents[gid]) continue; // 최상위 그룹(부위)만
            const ids = new Set<string>(get().getGroupDescendantPartIds(gid));
            const s = worldSizeOf(ids);
            if (s && s.width > 0 && s.height > 0) sizes.push(s);
          }
          if (sizes.length > 0) {
            const median = (arr: number[]): number => {
              const s = [...arr].sort((a, b) => a - b);
              const m = Math.floor(s.length / 2);
              return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
            };
            sizeRef = {
              width: median(sizes.map((b) => b.width)),
              height: median(sizes.map((b) => b.height)),
            };
          }
        }

        let rawSvg: string;
        try {
          const res = await fetch(asset.svgUrl);
          if (!res.ok) return;
          rawSvg = await res.text();
        } catch {
          return;
        }
        const parsed = parseRawSvgToParts(rawSvg);
        if (!parsed || parsed.parts.length === 0) return;

        if (!sizeRef) {
          const base = Math.min(sketch.canvas.width, sketch.canvas.height) * 0.4;
          sizeRef = { width: base, height: base };
        }

        // 크기 기준 박스를 캔버스 정중앙에 배치 — 위치는 항상 중앙(부위 자리에 스냅하지 않음).
        const targetBbox = {
          x: (sketch.canvas.width - sizeRef.width) / 2,
          y: (sketch.canvas.height - sizeRef.height) / 2,
          width: sizeRef.width,
          height: sizeRef.height,
        };

        const fitted = fitPartsToBbox(parsed.parts, targetBbox);

        const idStamp = `lib_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000).toString(36)}`;
        const newGroupId = `group_${idStamp}`;
        const newGroupName = `${asset.category} (${asset.name})`;

        const newPartIds: string[] = [];
        set((state) => {
          if (!state.sketch) return;
          const maxZ = state.sketch.parts.reduce((m, p) => (p.z_index > m ? p.z_index : m), 0);
          fitted.forEach((p, i) => {
            const id = `${idStamp}_${p.id}`;
            newPartIds.push(id);
            state.sketch!.parts.push({
              ...p,
              id,
              z_index: maxZ + 1 + i,
              group_id: newGroupId,
              visible: true,
            });
          });
          state.sketch.group_names = {
            ...state.sketch.group_names,
            [newGroupId]: newGroupName,
          };
          state.sketch.updated_at = new Date().toISOString();
          // 방금 올린 에셋을 선택 상태로 → 사용자가 바로 위치/크기를 조정할 수 있게.
          state.selectedPartIds = newPartIds;
          state.selectedAnchorId = null;
          state.selectedAnchors = [];
        });
      },

      importExternalVector: (rawSvg, label) => {
        const parsed = parseRawSvgToParts(rawSvg);
        if (!parsed || parsed.parts.length === 0) return;

        // 스케치가 없으면(업로드 단계) 빈 스케치를 먼저 만든다. createPlaceholderSketch
        // (canvas-panel) 와 동일한 800×1000 기본 캔버스/대지1 구성을 맞춘다.
        const now = new Date().toISOString();
        const existing = get().sketch;
        const sketch: Sketch =
          existing ??
          ({
            schema_version: '1.0.0',
            sketch_id:
              typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `sketch_${Date.now().toString(36)}`,
            garment_type: 'other',
            view: 'front',
            canvas: { width: 800, height: 1000 },
            parts: [],
            annotations: [],
            artboards: [
              {
                id: `artboard_import_${Date.now().toString(36)}`,
                name: '대지1',
                x: 0,
                y: 0,
                width: 800,
                height: 1000,
              },
            ],
            group_names: {},
            group_parents: {},
            brush_definitions: [],
            created_at: now,
            updated_at: now,
          } as Sketch);

        // 캔버스 80% 안에 비율 유지로 축소(작으면 원본 크기 유지) 후 중앙 배치.
        const srcW = parsed.canvas.width || 1;
        const srcH = parsed.canvas.height || 1;
        const cw = sketch.canvas.width;
        const ch = sketch.canvas.height;
        const scale = Math.min(1, (cw * 0.8) / srcW, (ch * 0.8) / srcH);
        const drawW = srcW * scale;
        const drawH = srcH * scale;
        const targetBbox = {
          x: (cw - drawW) / 2,
          y: (ch - drawH) / 2,
          width: drawW,
          height: drawH,
        };
        const fitted = fitPartsToBbox(parsed.parts, targetBbox);

        const idStamp = `imp_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000).toString(36)}`;
        const newGroupId = `group_${idStamp}`;
        const newPartIds: string[] = [];

        set((state) => {
          // 새 스케치라면 store 에 먼저 심는다(immer draft 로 교체).
          if (!state.sketch) state.sketch = JSON.parse(JSON.stringify(sketch)) as Sketch;
          const s = state.sketch;
          if (!s.group_names) s.group_names = {};
          if (!s.group_parents) s.group_parents = {};

          // 외부 SVG 내부의 <g> 구조도 보존한다. 단, 같은 파일을 여러 번 import 해도
          // 충돌하지 않도록 idStamp 를 prefix 해 별도 그룹 트리로 분리한다. 파싱된
          // 최상위 그룹은 사용자가 본 "라벨" 외곽 그룹(newGroupId) 의 자식이 된다.
          const stampGroupId = (gid: string) => `${idStamp}_${gid}`;

          const maxZ = s.parts.reduce((m, p) => (p.z_index > m ? p.z_index : m), 0);
          fitted.forEach((p, i) => {
            const id = `${idStamp}_${p.id}`;
            newPartIds.push(id);
            s.parts.push({
              ...p,
              id,
              z_index: maxZ + 1 + i,
              // 파싱이 부위 그룹을 찾았으면 그걸 stamp 해 쓰고, 아니면 외곽 그룹으로 폴백.
              group_id: p.group_id ? stampGroupId(p.group_id) : newGroupId,
              visible: true,
            });
          });

          s.group_names[newGroupId] = label;
          // 파싱된 그룹 메타 stamp 해서 머지.
          for (const [gid, name] of Object.entries(parsed.groupNames)) {
            s.group_names[stampGroupId(gid)] = name;
          }
          for (const [child, parent] of Object.entries(parsed.groupParents)) {
            s.group_parents[stampGroupId(child)] = stampGroupId(parent);
          }
          // 파싱된 최상위 그룹 (parents 에 키가 없는 것) → 외곽 그룹(newGroupId) 의 자식으로.
          for (const gid of Object.keys(parsed.groupNames)) {
            if (parsed.groupParents[gid] === undefined) {
              s.group_parents[stampGroupId(gid)] = newGroupId;
            }
          }
          s.updated_at = new Date().toISOString();

          // 가져온 직후 사용자가 무엇이 들어왔는지 바로 보도록 선택 상태로.
          state.selectedPartIds = newPartIds;
          state.selectedAnchorId = null;
          state.selectedAnchors = [];
        });
      },

      // 패턴 브러쉬 ─────────────────────────────────────────────────────────
      applyBrushToPart: (brushId, partId) =>
        set((state) => {
          if (!state.sketch) return;
          const id = partId ?? (state.selectedPartIds.length === 1 ? state.selectedPartIds[0] : undefined);
          if (!id) return;
          const part = state.sketch.parts.find((p) => p.id === id);
          if (!part) return;
          // brush_id 만 설정 — 나머지 파라미터는 정의 기본값을 따른다(렌더 시점에 resolve).
          // 기존 오버라이드가 있으면 새 브러쉬로 교체하므로 초기화한다.
          const hadBrush = !!part.brush;
          part.brush = { brush_id: brushId };
          // 브러쉬 크기는 외곽선 '굵기'(stroke_width)에 맞춰진다(resolveBrushParamsForPart).
          // 처음 적용할 때(또는 굵기가 0일 때)는 브러쉬 자연 높이(× 기본 scale)로 굵기를 세팅해
          // scale=1, 즉 브러쉬가 디자인된 크기 그대로 보이게 한다 — 이후 사용자가 '굵기'로 조절.
          // 다른 브러쉬로 교체할 때는 사용자가 맞춰둔 굵기를 그대로 유지한다.
          const def = findBrushDefinition(brushId, state.sketch);
          if (def && (!hadBrush || !(part.stroke_width > 0))) {
            part.stroke_width = def.tiles.side.height * def.scale;
          }
          state.sketch.updated_at = new Date().toISOString();
        }),

      updatePartBrushParams: (partId, patch) =>
        set((state) => {
          if (!state.sketch) return;
          const part = state.sketch.parts.find((p) => p.id === partId);
          if (!part || !part.brush) return;
          part.brush = { ...part.brush, ...patch };
          state.sketch.updated_at = new Date().toISOString();
        }),

      removeBrushFromPart: (partId) =>
        set((state) => {
          if (!state.sketch) return;
          const part = state.sketch.parts.find((p) => p.id === partId);
          if (!part) return;
          part.brush = undefined;
          state.sketch.updated_at = new Date().toISOString();
        }),

      addUserBrush: (def) =>
        set((state) => {
          if (!state.sketch) return;
          const existing = state.sketch.brush_definitions.findIndex((b) => b.id === def.id);
          if (existing >= 0) state.sketch.brush_definitions[existing] = def;
          else state.sketch.brush_definitions.push(def);
          state.sketch.updated_at = new Date().toISOString();
        }),

      removeUserBrush: (brushId) =>
        set((state) => {
          if (!state.sketch) return;
          state.sketch.brush_definitions = state.sketch.brush_definitions.filter(
            (b) => b.id !== brushId,
          );
          // 이 브러쉬를 참조하던 파트들의 brush 해제.
          for (const part of state.sketch.parts) {
            if (part.brush?.brush_id === brushId) part.brush = undefined;
          }
          state.sketch.updated_at = new Date().toISOString();
        }),

      expandBrush: (partId) => {
        // 베이킹(paper.js)은 immer producer 밖에서 — draft 프록시를 paper 에 넘기지 않도록
        // 현재 스냅샷으로 먼저 계산하고, 결과만 set 안에서 반영한다.
        const snap = get();
        const sketch = snap.sketch;
        if (!sketch) return;
        const id =
          partId ??
          (snap.selectedPartIds.length === 1 ? snap.selectedPartIds[0] : undefined);
        if (!id) return;
        const part = sketch.parts.find((p) => p.id === id);
        if (!part || !part.brush) return;
        const result = expandBrushPart(part, sketch);
        if (!result || result.parts.length === 0) return;

        const stamp = `bexp_${Date.now().toString(36)}_${Math.floor(
          Math.random() * 1000,
        ).toString(36)}`;
        const newGroupId = `group_${stamp}`;

        set((state) => {
          if (!state.sketch) return;
          const idx = state.sketch.parts.findIndex((p) => p.id === id);
          if (idx < 0) return;
          const maxZ = state.sketch.parts.reduce(
            (m, p) => (p.z_index > m ? p.z_index : m),
            0,
          );
          result.parts.forEach((p, i) => {
            state.sketch!.parts.push({
              ...p,
              id: `${stamp}_${i}`,
              z_index: maxZ + 1 + i,
              group_id: newGroupId,
              visible: true,
            });
          });
          state.sketch.group_names = {
            ...state.sketch.group_names,
            [newGroupId]: result.brushName,
          };
          // 원본 브러쉬 spine 파트 제거.
          state.sketch.parts.splice(idx, 1);
          state.selectedPartIds = [];
          state.selectedAnchorId = null;
          state.selectedAnchors = [];
          state.sketch.updated_at = new Date().toISOString();
        });
      },
    })),
    {
      // sketch 스냅샷만 히스토리에 둔다. 뷰포트/선택/패널 모드는 undo 대상 아님.
      partialize: (state) => ({ sketch: state.sketch }),
      // sketch가 실제로 바뀐 경우에만 새 스냅샷 적재.
      equality: (a, b) => a.sketch === b.sketch,
      limit: 100,
    },
  ),
);

// Cmd/Ctrl+Z 핸들러용. 컴포넌트에서 useEditorStore.temporal.getState().undo() 호출.
export const useTemporalStore = useEditorStore.temporal;

// 데모용 스냅샷 캡처 — 라이브러리 에셋을 캔버스에 떨어뜨린 뒤 손으로 위치/스케일을 맞추고,
// 콘솔에서 `__dumpLibrarySnapshot('Collar (Round Collar)')` (또는 group id) 호출하면
// 매칭 그룹의 visible part 들을 transform → anchor baking 한 LIBRARY_ASSET_SNAPSHOTS 형식
// JSON 으로 클립보드에 복사한다. 그 값을 library-asset-snapshots.ts 에 붙이면 다음 적용
// 시 정확히 그 위치·두께로 떨어진다.
//
// 입력 매칭 — id 정확일치 → 이름 정확일치 → 이름 prefix 일치 union (예: Puff Sleeve 처럼
// 'Sleeve (Puff Sleeve) (L)' / '(R)' 두 그룹으로 분리된 케이스에서 'Sleeve (Puff Sleeve)'
// 하나로 양쪽을 한 번에 dump). 배열을 넘기면 각 항목을 같은 규칙으로 매칭해 union.
if (typeof window !== 'undefined') {
  (window as unknown as {
    __dumpLibrarySnapshot?: (g: string | string[]) => string | null;
  }).__dumpLibrarySnapshot =
    function dumpLibrarySnapshot(groupOrId: string | string[]): string | null {
      const state = useEditorStore.getState();
      const sketch = state.sketch;
      if (!sketch) {
        console.warn('[dumpLibrarySnapshot] no sketch loaded');
        return null;
      }
      const inputs = Array.isArray(groupOrId) ? groupOrId : [groupOrId];
      const gids = new Set<string>();
      for (const input of inputs) {
        if (sketch.group_names[input]) {
          gids.add(input);
          continue;
        }
        const exact = Object.entries(sketch.group_names).find(
          ([, name]) => name === input,
        );
        if (exact) {
          gids.add(exact[0]);
          continue;
        }
        const prefixed = Object.entries(sketch.group_names).filter(([, name]) =>
          name.startsWith(input),
        );
        if (prefixed.length > 0) {
          for (const [g] of prefixed) gids.add(g);
          continue;
        }
        console.warn(
          `[dumpLibrarySnapshot] group not found: ${input}. Available: ${Object.values(
            sketch.group_names,
          ).join(' / ')}`,
        );
        return null;
      }
      const partIds = new Set<string>();
      for (const gid of gids) {
        for (const pid of state.getGroupDescendantPartIds(gid)) {
          partIds.add(pid);
        }
      }
      const baked = sketch.parts
        .filter((p) => partIds.has(p.id) && p.visible !== false)
        .sort((a, b) => a.z_index - b.z_index)
        .map((p) => {
          const t = p.transform ?? DEFAULT_TRANSFORM;
          const cloned = JSON.parse(JSON.stringify(p)) as Part;
          cloned.anchors = cloned.anchors.map((a) =>
            transformAnchor(a, t, DEFAULT_TRANSFORM),
          );
          // stroke 도 함께 baked. Konva 는 strokeScaleEnabled=true 라 transform.scaleX 가
          // stroke 두께에 곱해지므로, anchor 만 baking 하고 stroke 를 그대로 두면 캔버스
          // 두께가 1/scale 배 만큼 두꺼워진다 (예: scale=0.146 + stroke=2 → 캡처 시 0.29 로
          // 보이던 게 baking 후 2 로 렌더). dasharray 도 같은 비율로 늘려야 패턴 길이 보존.
          bakeStrokeIntoIdentity(cloned, t);
          cloned.transform = { ...DEFAULT_TRANSFORM };
          recompilePartPath(cloned);
          cloned.z_index = 0;
          delete (cloned as { group_id?: string }).group_id;
          return cloned;
        });
      const json = JSON.stringify(baked);
      void navigator.clipboard?.writeText(json).catch(() => undefined);
      console.log(
        `[dumpLibrarySnapshot] ${baked.length} parts → clipboard.\n` +
          `paste into LIBRARY_ASSET_SNAPSHOTS in apps/web/lib/library-asset-snapshots.ts`,
      );
      return json;
    };
}

// part.anchors 변경 후 svg_paths[0]을 새로 컴파일.
// anchors가 비어 있으면(과거 데이터) 기존 svg_paths를 보존 — 사용자가 raw_svg 재파싱 안 한
// 프로젝트가 갑자기 빈 path로 깨지지 않도록.
function recompilePartPath(part: Part): void {
  if (part.anchors.length === 0) return;
  const d = compileAnchorsToD(part.anchors, part.subpath_breaks, part.subpath_closed);
  if (!d) return;
  part.svg_paths = [d];
}

// path-로컬 bbox를 신뢰 가능한 형태로 반환. svg-to-parts 단계에서 bounding_box가
// {0,0,0,0} 플레이스홀더로 들어오는 케이스가 있어, 그 경우 anchors/handles 좌표로
// 직접 계산한다. flip/정렬처럼 "파트 중심"을 기준으로 하는 연산이 placeholder bbox를
// 그대로 쓰면 cx=0이 되어 좌측으로 튕겨 사라지는 버그가 난다.
function getLocalBoundingBox(part: Part): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const bb = part.bounding_box;
  if (bb && (bb.width > 0 || bb.height > 0)) return bb;
  const anchors = part.anchors;
  if (!anchors || anchors.length === 0) return bb ?? { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const a of anchors) {
    if (Number.isFinite(a.x) && Number.isFinite(a.y)) {
      if (a.x < minX) minX = a.x;
      if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y;
      if (a.y > maxY) maxY = a.y;
    }
    if (a.handle_in) {
      if (a.handle_in.x < minX) minX = a.handle_in.x;
      if (a.handle_in.x > maxX) maxX = a.handle_in.x;
      if (a.handle_in.y < minY) minY = a.handle_in.y;
      if (a.handle_in.y > maxY) maxY = a.handle_in.y;
    }
    if (a.handle_out) {
      if (a.handle_out.x < minX) minX = a.handle_out.x;
      if (a.handle_out.x > maxX) maxX = a.handle_out.x;
      if (a.handle_out.y < minY) minY = a.handle_out.y;
      if (a.handle_out.y > maxY) maxY = a.handle_out.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return bb ?? { x: 0, y: 0, width: 0, height: 0 };
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// 여러 파트의 world 좌표 X 범위를 합집합으로 반환. flip 그룹 중심 계산용.
// scaleX 가 음수면 world bbox 의 좌/우가 뒤집히므로 양 끝을 모두 보고 min/max 를 잡는다.
function unionWorldXRange(parts: Part[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of parts) {
    const t = p.transform ?? DEFAULT_TRANSFORM;
    const sx = t.scaleX || 1;
    const lbb = getLocalBoundingBox(p);
    const a = lbb.x * sx + t.x;
    const b = (lbb.x + lbb.width) * sx + t.x;
    if (a < min) min = a;
    if (b < min) min = b;
    if (a > max) max = a;
    if (b > max) max = b;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0 };
  return { min, max };
}

function unionWorldYRange(parts: Part[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of parts) {
    const t = p.transform ?? DEFAULT_TRANSFORM;
    const sy = t.scaleY || 1;
    const lbb = getLocalBoundingBox(p);
    const a = lbb.y * sy + t.y;
    const b = (lbb.y + lbb.height) * sy + t.y;
    if (a < min) min = a;
    if (b < min) min = b;
    if (a > max) max = a;
    if (b > max) max = b;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0 };
  return { min, max };
}

// 한 anchor 만 splice 로 빼고 그에 맞춰 subpath_breaks/subpath_closed 를 정리한다.
// 서브패스가 비어버리면 그 break/closed 엔트리도 같이 제거. deleteAnchor 액션과 동일한 규칙.
function removeAnchorAt(part: Part, idx: number): void {
  if (idx < 0 || idx >= part.anchors.length) return;
  const breaks = part.subpath_breaks ?? [];
  const closed = part.subpath_closed ?? [];
  const starts = [0, ...breaks];
  const ranges = starts.map((s, i) => {
    const e = i + 1 < starts.length ? starts[i + 1]! : part.anchors.length;
    return [s, e] as [number, number];
  });
  const subIdx = ranges.findIndex(([s, e]) => s <= idx && idx < e);
  if (subIdx === -1) return;
  const [s, e] = ranges[subIdx]!;
  const subLen = e - s;

  if (subLen <= 1) {
    part.anchors.splice(idx, 1);
    const newBreaks = [...breaks];
    const newClosed = [...closed];
    if (subIdx === 0) {
      if (newBreaks.length > 0) newBreaks.shift();
      if (newClosed.length > 0) newClosed.shift();
    } else {
      newBreaks.splice(subIdx - 1, 1);
      if (subIdx < newClosed.length) newClosed.splice(subIdx, 1);
    }
    for (let i = 0; i < newBreaks.length; i++) {
      if (newBreaks[i]! > idx) newBreaks[i] = newBreaks[i]! - 1;
    }
    part.subpath_breaks = newBreaks.length > 0 ? newBreaks : undefined;
    part.subpath_closed = newClosed.length > 0 ? newClosed : undefined;
  } else {
    part.anchors.splice(idx, 1);
    const newBreaks = breaks.map((b) => (b > idx ? b - 1 : b));
    part.subpath_breaks = newBreaks.length > 0 ? newBreaks : undefined;
  }
}

// 앵커가 어느 서브패스의 끝점(첫/마지막)에 있는지 — 없으면 null. 닫힌 서브패스에는 endpoint 가
// 없으므로 join 대상이 아니다.
interface EndpointInfo {
  subIdx: number;
  position: 'start' | 'end';
  s: number;
  e: number;
  anchorIdx: number;
}

function findEndpointInfo(part: Part, anchorId: string): EndpointInfo | null {
  const idx = part.anchors.findIndex((a) => a.id === anchorId);
  if (idx === -1) return null;
  const breaks = part.subpath_breaks ?? [];
  const closed = part.subpath_closed ?? [];
  const starts = [0, ...breaks];
  const ranges = starts.map((s, i) => {
    const e = i + 1 < starts.length ? starts[i + 1]! : part.anchors.length;
    return [s, e] as [number, number];
  });
  const subIdx = ranges.findIndex(([s, e]) => s <= idx && idx < e);
  if (subIdx === -1) return null;
  if (closed[subIdx]) return null;
  const [s, e] = ranges[subIdx]!;
  if (idx === s) return { subIdx, position: 'start', s, e, anchorIdx: idx };
  if (idx === e - 1) return { subIdx, position: 'end', s, e, anchorIdx: idx };
  return null;
}

// 서브패스 anchors 배열을 뒤집을 때, 진행 방향이 반대가 되므로 핸들도 in↔out 을 swap 해야 한다.
function reverseSubpath(anchors: Anchor[]): Anchor[] {
  return anchors
    .slice()
    .reverse()
    .map((a) => ({
      ...a,
      handle_in: a.handle_out ? { ...a.handle_out } : undefined,
      handle_out: a.handle_in ? { ...a.handle_in } : undefined,
    }));
}

// 두 점이 충분히 가까우면 같은 위치로 본다 (snap-to-merge / 닫기 판정용).
const COINCIDENT_EPS = 0.5;

function pointsCoincide(
  a: { x: number; y: number },
  b: { x: number; y: number },
  eps: number = COINCIDENT_EPS,
): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

// 서브패스의 첫/마지막 anchor 가 일치하면 닫고 마지막 anchor 를 합친다 (dedupe).
// 마지막 anchor 의 handle_in 은 시작 anchor 의 handle_in 으로 이전 — compileAnchorsToD 가
// 닫는 segment 에 cur.handle_in 을 쓰므로 들어오는 곡선 모양이 보존된다.
// 호출 후 part.anchors / breaks / closed 가 정합 상태. 닫혔으면 true.
function closeSubpathIfCoincident(
  part: Part,
  subIdx: number,
  eps: number = COINCIDENT_EPS,
): boolean {
  const breaks = part.subpath_breaks ?? [];
  const closed = part.subpath_closed ?? [];
  const starts = [0, ...breaks];
  if (subIdx < 0 || subIdx >= starts.length) return false;
  if (closed[subIdx]) return false;
  const s = starts[subIdx]!;
  const e = subIdx + 1 < starts.length ? starts[subIdx + 1]! : part.anchors.length;
  if (e - s < 3) return false; // 2 anchor 이하면 닫힘이 의미 없음.

  const first = part.anchors[s]!;
  const last = part.anchors[e - 1]!;
  if (!pointsCoincide(first, last, eps)) return false;

  // last.handle_in 을 first.handle_in 으로 이전 — 닫는 segment 가 (e-2) → s 로 갈 때
  // 첫 anchor 의 handle_in 이 들어오는 곡선 모양을 결정하므로, dropped anchor 가 가지고 있던
  // handle_in 을 그쪽으로 옮겨야 형태 보존됨.
  if (last.handle_in) {
    first.handle_in = { ...last.handle_in };
  }
  // last anchor 제거 + breaks 보정.
  part.anchors.splice(e - 1, 1);
  if (part.subpath_breaks) {
    const nb = part.subpath_breaks.map((br) => (br > e - 1 ? br - 1 : br));
    part.subpath_breaks = nb.length > 0 ? nb : undefined;
  }
  const nc = [...(part.subpath_closed ?? [])];
  while (nc.length <= subIdx) nc.push(false);
  nc[subIdx] = true;
  part.subpath_closed = nc;
  return true;
}

// 두 endpoint 가 인접해지도록 서브패스를 뒤집어 잇고, part.anchors / breaks / closed 를 재구성.
// 결과는 한 개의 열린 서브패스(close=false). 같은 서브패스를 join 하려는 호출은 무시.
function joinSubpaths(part: Part, epA: EndpointInfo, epB: EndpointInfo): void {
  if (epA.subIdx === epB.subIdx) return;
  const breaks = part.subpath_breaks ?? [];
  const closed = part.subpath_closed ?? [];
  const starts = [0, ...breaks];
  const ranges = starts.map((s, i) => {
    const e = i + 1 < starts.length ? starts[i + 1]! : part.anchors.length;
    return [s, e] as [number, number];
  });

  const subAnchors: Anchor[][] = ranges.map(([s, e]) => part.anchors.slice(s, e));
  const subClosed: boolean[] = ranges.map((_, i) => !!closed[i]);

  const aArr = subAnchors[epA.subIdx]!;
  const bArr = subAnchors[epB.subIdx]!;

  let merged: Anchor[];
  if (epA.position === 'end' && epB.position === 'start') {
    merged = [...aArr, ...bArr];
  } else if (epA.position === 'end' && epB.position === 'end') {
    merged = [...aArr, ...reverseSubpath(bArr)];
  } else if (epA.position === 'start' && epB.position === 'start') {
    merged = [...reverseSubpath(aArr), ...bArr];
  } else {
    // A.start + B.end → bArr ++ aArr (양쪽 모두 뒤집는 것보다 깔끔).
    merged = [...bArr, ...aArr];
  }

  const lo = Math.min(epA.subIdx, epB.subIdx);
  const hi = Math.max(epA.subIdx, epB.subIdx);
  const newSubAnchors = subAnchors.slice();
  const newSubClosed = subClosed.slice();
  newSubAnchors.splice(hi, 1);
  newSubClosed.splice(hi, 1);
  newSubAnchors[lo] = merged;
  newSubClosed[lo] = false;

  const flat: Anchor[] = [];
  const newBreaks: number[] = [];
  for (let i = 0; i < newSubAnchors.length; i++) {
    if (i > 0) newBreaks.push(flat.length);
    for (const a of newSubAnchors[i]!) flat.push(a);
  }
  part.anchors = flat;
  part.subpath_breaks = newBreaks.length > 0 ? newBreaks : undefined;
  part.subpath_closed = newSubClosed.length > 0 ? newSubClosed : undefined;
}

// part-local 좌표 (px, py) 를 transform t (translate→rotate→scale 순) 적용해 world 로 보낸다.
// 적용 순서: scale → rotate → translate.
function localToWorld(p: { x: number; y: number }, t: Transform): { x: number; y: number } {
  const rad = (t.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const sx = p.x * t.scaleX;
  const sy = p.y * t.scaleY;
  return { x: sx * c - sy * s + t.x, y: sx * s + sy * c + t.y };
}

function worldToLocal(p: { x: number; y: number }, t: Transform): { x: number; y: number } {
  const rad = (t.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  const ux = dx * c + dy * s;
  const uy = -dx * s + dy * c;
  const sx = t.scaleX === 0 ? 1 : t.scaleX;
  const sy = t.scaleY === 0 ? 1 : t.scaleY;
  return { x: ux / sx, y: uy / sy };
}

// fromT 좌표계의 anchor 를 toT 좌표계로 옮긴다 — anchor 와 두 핸들의 위치를 world 경유로 변환.
// id/type/kind 등 메타데이터는 그대로 유지.
// transform.scale 을 stroke_width / stroke_dasharray 에 곱해 identity transform 으로
// 옮긴 뒤에도 캔버스 두께가 그대로 유지되도록 한다. Konva Path 는 strokeScaleEnabled
// 기본값이 true 라 transform.scaleX 가 stroke 에 곱해진다 — anchor 만 baking 하고
// stroke 를 안 건드리면 baking 후 stroke 가 1/scale 배 두꺼워지는 회귀가 난다.
function bakeStrokeIntoIdentity(part: Part, fromT: Transform): void {
  const sx = Math.abs(fromT.scaleX);
  const sy = Math.abs(fromT.scaleY);
  const s = (sx + sy) / 2;
  if (!Number.isFinite(s) || s === 1) return;
  if (typeof part.stroke_width === 'number') {
    part.stroke_width = part.stroke_width * s;
  }
  if (Array.isArray(part.stroke_dasharray)) {
    part.stroke_dasharray = part.stroke_dasharray.map((v) => v * s);
  }
}

function transformAnchor(anchor: Anchor, fromT: Transform, toT: Transform): Anchor {
  const convert = (p: { x: number; y: number }) => worldToLocal(localToWorld(p, fromT), toT);
  const xy = convert({ x: anchor.x, y: anchor.y });
  const next: Anchor = { ...anchor, x: xy.x, y: xy.y };
  if (anchor.handle_in) {
    const h = convert(anchor.handle_in);
    next.handle_in = { x: h.x, y: h.y };
  } else {
    next.handle_in = undefined;
  }
  if (anchor.handle_out) {
    const h = convert(anchor.handle_out);
    next.handle_out = { x: h.x, y: h.y };
  } else {
    next.handle_out = undefined;
  }
  return next;
}

// ─── Pathfinder helpers ──────────────────────────────────────
// flattenPart 결과를 polygon-clipping 입력으로 변환할 때 쓰는 보조 함수들.

// Region = 닫힌 서브패스가 하나라도 있어 면적을 형성하는 part.
// 펜으로 그린 *오픈* 서브패스만 가진 part 는 면적이 0 이라 polygon-clipping 의
// intersection/difference 가 의미 없는 결과를 낸다 (이전 fix 가 hasFlattenableArea
// 만 풀어 zero-area sliver 가 들어가 silently no-op 되던 회귀의 진짜 원인).
function isRegionPart(part: Part): boolean {
  if (!part.anchors || part.anchors.length < 3) return false;
  const closed = part.subpath_closed ?? [];
  return closed.some((c) => c);
}

// Knife = 모든 서브패스가 열린 part. divide 시 region 을 자르는 "칼" 로 동작.
// (사각형 + 펜으로 그은 선) 케이스가 여기 해당. anchor ≥2 면 칼로 받는다.
function isKnifePart(part: Part): boolean {
  if (!part.anchors || part.anchors.length < 2) return false;
  const closed = part.subpath_closed ?? [];
  if (closed.some((c) => c)) return false;
  return true;
}

// 기존 호출자 호환 — 영역으로 쓸 수 있는지 (region 이거나, 적어도 ≥3 anchor 인 sliver).
// unite/intersect/exclude 등은 여전히 일러스트 동작에 맞춰 open path 도 implicit close 로
// 받지만, divide 만 별도 분기에서 isRegionPart 로 엄격히 거른다.
function hasFlattenableArea(part: Part): boolean {
  if (!part.anchors || part.anchors.length < 3) return false;
  return true;
}

// part-local anchors 를 평탄화한 뒤 transform 적용해 world 좌표 ring(들) 로 반환.
// 각 서브패스(닫힘/열림 무관)는 ≥3 점이면 polygon ring 으로 사용 — 열린 path 는 마지막 점에서
// 첫 점으로의 가상 직선으로 닫힌 것처럼 처리한다 (일러스트 Pathfinder 동작과 일치).
function partToWorldMultiPolygon(part: Part): MultiPolygon {
  const flats = flattenPart(part);
  const t = part.transform ?? DEFAULT_TRANSFORM;
  const out: MultiPolygon = [];
  for (const sub of flats) {
    if (sub.points.length < 3) continue;
    const ring: Ring = sub.points.map((p) => {
      const w = localToWorld({ x: p.x, y: p.y }, t);
      return [w.x, w.y] as Pair;
    });
    // polygon-clipping 은 ring 을 자동으로 닫는다. 열린 path 면 마지막→첫 점 직선이 implicit
    // close edge 가 됨. 단, ring 좌표가 colinear 이거나 면적이 0 이면 자동으로 결과에서 빠진다.
    out.push([ring]);
  }
  return out;
}

// Knife part (펜으로 그린 열린 path) 를 "두께 거의 0 인 띠 폴리곤" 으로 변환.
// divide 시 region polygon 에서 difference 로 빼면 region 이 띠를 따라 두 조각으로 갈라진다.
// halfWidth 는 sub-pixel (기본 0.001) — 시각적으로 슬릿이 보이지 않을 만큼 얇다.
// pad 는 폴리라인 양 끝점을 진행방향으로 늘려, 칼이 region 경계를 *완전히* 가로지르도록 보장.
//   - pad 가 부족하면 region 안에서 끝나는 슬릿이 되어 두 조각이 아니라 한 조각에 홈만 남는다.
//   - pad 는 호출자가 region bbox 기준으로 충분히 크게 넘긴다.
function knifeToWorldMultiPolygon(
  part: Part,
  pad: number,
  halfWidth: number,
): MultiPolygon {
  const flats = flattenPart(part);
  const t = part.transform ?? DEFAULT_TRANSFORM;
  // 각 세그먼트를 자기 자신만 담은 MultiPolygon 으로 만들어 union(...) 가변인자에 그대로 넘긴다.
  const segmentMultiPolys: MultiPolygon[] = [];
  for (const sub of flats) {
    if (sub.points.length < 2) continue;

    // world 좌표로 변환.
    const wpts = sub.points.map((p) => localToWorld({ x: p.x, y: p.y }, t));

    // 양 끝점을 pad 만큼 진행방향으로 연장 — region 경계를 완전히 가로지르게.
    if (wpts.length >= 2) {
      const a = wpts[0]!;
      const b = wpts[1]!;
      const dx0 = a.x - b.x, dy0 = a.y - b.y;
      const len0 = Math.hypot(dx0, dy0);
      if (len0 > 1e-9) {
        wpts[0] = { x: a.x + (dx0 / len0) * pad, y: a.y + (dy0 / len0) * pad };
      }
      const c = wpts[wpts.length - 2]!;
      const d = wpts[wpts.length - 1]!;
      const dx1 = d.x - c.x, dy1 = d.y - c.y;
      const len1 = Math.hypot(dx1, dy1);
      if (len1 > 1e-9) {
        wpts[wpts.length - 1] = { x: d.x + (dx1 / len1) * pad, y: d.y + (dy1 / len1) * pad };
      }
    }

    // 각 세그먼트를 halfWidth 두께의 직사각형으로 변환. 인접 세그먼트와 확실히 겹치도록
    // 길이 방향으로도 halfWidth 만큼 양 끝을 늘린다 (코너에서 띠가 끊기지 않게).
    for (let i = 0; i < wpts.length - 1; i++) {
      const a = wpts[i]!;
      const b = wpts[i + 1]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const nx = (-dy / len) * halfWidth;
      const ny = (dx / len) * halfWidth;
      const ex = (dx / len) * halfWidth;
      const ey = (dy / len) * halfWidth;
      const ax = a.x - ex, ay = a.y - ey;
      const bx = b.x + ex, by = b.y + ey;
      const rect: Ring = [
        [ax + nx, ay + ny] as Pair,
        [bx + nx, by + ny] as Pair,
        [bx - nx, by - ny] as Pair,
        [ax - nx, ay - ny] as Pair,
      ];
      // MultiPolygon = Polygon[] = Ring[][] — 한 세그먼트 = 한 Polygon (= [rect]) 을 담은 MultiPolygon.
      segmentMultiPolys.push([[rect]]);
    }
  }
  if (segmentMultiPolys.length === 0) return [];
  if (segmentMultiPolys.length === 1) return segmentMultiPolys[0]!;
  try {
    const [first, ...rest] = segmentMultiPolys as [
      MultiPolygon,
      ...MultiPolygon[],
    ];
    return polygonClipping.union(first, ...rest);
  } catch {
    // union 실패 시 모든 직사각형을 평탄하게 합쳐 반환 — 미세하게 끊긴 칼이 되지만 안전.
    return segmentMultiPolys.flat();
  }
}

// polygon-clipping 출력 (MultiPolygon = Array<Polygon> = Array<Array<Ring>>) 을 새 Part 배열로.
// 각 Polygon 의 첫 ring 은 outer, 나머지는 hole. 하나의 Polygon 은 outer 와 hole 들을 같은
// part 의 subpath 들로 묶어 표현 — Konva.Path 가 fillRule='evenodd' 또는 winding 으로 hole
// 을 자동 처리하도록 기대. 이 코드베이스의 svg_paths/Path 렌더는 fillRule 을 별도로 지정하지
// 않으므로 (nonzero 디폴트), polygon-clipping 의 winding (outer CCW, hole CW) 을 그대로 살려
// nonzero 규칙에서도 hole 처리가 가능.
//
// template: 스타일/카테고리/이름 베이스. baseZ: 결과의 첫 part z_index 베이스. mode 는 디버그용 라벨.
function multiPolygonToParts(
  mp: MultiPolygon,
  template: Part,
  baseZ: number,
  mode: 'unite' | 'divide' | 'subtract' | 'intersect' | 'exclude',
): Part[] {
  const out: Part[] = [];
  let z = baseZ;
  for (let pi = 0; pi < mp.length; pi++) {
    const polygon = mp[pi]!;
    if (polygon.length === 0) continue;

    const anchors: Anchor[] = [];
    const breaks: number[] = [];
    const closedFlags: boolean[] = [];
    let hasContent = false;

    for (let ri = 0; ri < polygon.length; ri++) {
      const ring = polygon[ri]!;
      // polygon-clipping 은 ring 의 마지막 점에 첫 점을 한 번 더 붙여 닫힘을 명시한다 — 중복 제거.
      const trimmed: Pair[] = [];
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!;
        if (
          i === ring.length - 1 &&
          trimmed.length > 0 &&
          Math.abs(p[0] - trimmed[0]![0]) < 1e-9 &&
          Math.abs(p[1] - trimmed[0]![1]) < 1e-9
        ) {
          continue;
        }
        trimmed.push(p);
      }
      if (trimmed.length < 3) continue;

      if (anchors.length > 0) breaks.push(anchors.length);
      const subpathTag = `pf_${mode}_${pi}_${ri}`;
      for (let i = 0; i < trimmed.length; i++) {
        const [x, y] = trimmed[i]!;
        anchors.push({
          id: `anchor_${subpathTag}_${i}`,
          x,
          y,
          type: 'edit_point',
          kind: 'corner',
        });
      }
      closedFlags.push(true);
      hasContent = true;
    }

    if (!hasContent) continue;

    // bounding_box 는 anchors 로부터 직접 계산 (transform 이 identity 이므로 path-local == world).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const a of anchors) {
      if (a.x < minX) minX = a.x;
      if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y;
      if (a.y > maxY) maxY = a.y;
    }

    z += 1;
    const id = `part_${mode}_${Date.now().toString(36)}_${Math.floor(Math.random() * 100000)}_${pi}`;
    const newPart: Part = {
      id,
      category: template.category,
      subtype: template.subtype,
      svg_paths: [],
      fill: template.fill,
      stroke: template.stroke,
      stroke_width: template.stroke_width,
      stroke_dasharray: template.stroke_dasharray ? [...template.stroke_dasharray] : undefined,
      stroke_linecap: template.stroke_linecap,
      stroke_linejoin: template.stroke_linejoin,
      anchors,
      subpath_breaks: breaks.length > 0 ? breaks : undefined,
      subpath_closed: closedFlags,
      bounding_box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      z_index: z,
      editable: true,
      swappable: true,
      // anchors 를 이미 world 좌표로 베이크했으므로 transform 은 identity.
      transform: { ...DEFAULT_TRANSFORM },
      metadata: {},
      visible: template.visible,
      locked: template.locked,
    };
    recompilePartPath(newPart);
    out.push(newPart);
  }
  return out;
}

// 사용하지 않는 import 경고 회피용. Anchor 타입은 액션 내부에서 immer가 추론해 직접 참조하지 않지만
// 외부에서 store 액션을 사용할 때 type-side 참조용으로 export 가능하도록 둔다.
export type { Anchor };
