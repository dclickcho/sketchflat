'use client';
// 초기 의류 사진 업로드 페이지의 풀스크린 랜딩 — Quiver AI 레퍼런스(quiver_refer.png) 기반.
// Image input 박스는 더 이상 여기서 렌더하지 않는다. 하단 플로팅 툴바의 Sparkle(AI 생성)
// 버튼이 image-input-panel.tsx 의 노출을 토글한다 — 이 컴포넌트는 헤드라인 + 타일 그리드만 담당.

export function UploadPhase() {
  return (
    <div className="absolute inset-0 z-10 overflow-hidden bg-white font-sans">
      {/* 헤드라인 + 타일 그리드는 동일한 max-w 컨테이너에 들어가 좌측 끝이 정확히 맞도록.
          텍스트는 좌측 정렬, 'mind,' 뒤에서 두 줄로 끊는다. */}
      <div
        className="absolute inset-x-0 px-12 pointer-events-none"
        style={{ top: '15%', transform: 'translateY(-50%)' }}
      >
        <div className="mx-auto" style={{ maxWidth: 880 }}>
          <h1
            className="text-left text-[44px] leading-[1.2] tracking-tight text-neutral-400 font-sans"
            style={{ fontWeight: 300, letterSpacing: '-0.5px' }}
          >
            Whatever clothing you have in mind,
            <br />
            sketch it,{' '}
            {/* 강조 부분: 볼드 제거 + 검정 대신 연한 회색으로. 같은 weight 300 유지. */}
            <span className="text-neutral-500">
              shape it into flat sketches.
            </span>
          </h1>
        </div>
      </div>

      {/* 배경 일러스트 그리드 — 헤드라인과 같은 max-w 컨테이너로 좌측 끝을 맞추고, 컨테이너
          폭을 줄여 타일 너비도 같이 축소. */}
      <div
        className="absolute inset-x-0 px-12 pointer-events-none"
        style={{ top: '28%', bottom: 24 }}
      >
        <div className="mx-auto" style={{ maxWidth: 880 }}>
          {/* Quiver 레퍼런스(quiver_refer2) 와 같이 1:1 정사각 타일. image input 박스가
              타일 위에 살짝 겹쳐도 의도된 구성이라 별도 보정 없음. */}
          <div className="grid grid-cols-4 gap-4">
            {CLOTHING_TILES.map((tile, i) => (
              <div
                key={i}
                className="relative rounded-2xl overflow-hidden flex items-center justify-center"
                style={{ background: tile.bg, aspectRatio: '1 / 1' }}
                aria-hidden="true"
              >
                {/* PNG 도식화는 흰 배경 + 검정 선. blend mode 로 배경을 투명화하고
                    선을 타일별로 흰/검정으로 노출. */}
                <img
                  src={tile.src}
                  alt=""
                  className="select-none"
                  draggable={false}
                  style={{
                    width: '72%',
                    height: '72%',
                    objectFit: 'contain',
                    // line='black': multiply 로 흰 배경 제거, 검정 선만 남김.
                    // line='white': 이미지 반전 후 screen 으로 검정(원래 흰) 배경 제거,
                    //               흰(원래 검정) 선만 남김.
                    mixBlendMode: tile.line === 'white' ? 'screen' : 'multiply',
                    filter: tile.line === 'white' ? 'invert(1)' : 'none',
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 의류 도식화 타일 — 1~8.png (흰 배경 + 검정 라인 PNG) 를 blend mode 로 합성.
// line='black' 은 multiply (흰 배경 제거, 검정 선 유지).
// line='white' 는 invert + screen (반전된 흰 선만 노출, 검정 배경 제거).
// 배경색은 그대로 유지하면서 선 색만 타일별로 가독성 좋은 쪽으로 결정.
// ────────────────────────────────────────────────────────────

type TileLine = 'white' | 'black';
const CLOTHING_TILES: { bg: string; src: string; line: TileLine }[] = [
  { bg: '#5BBDF2', src: '/upload-tiles/1.png', line: 'white' },
  { bg: '#3F4D2C', src: '/upload-tiles/2.png', line: 'white' },
  { bg: '#F5E6C8', src: '/upload-tiles/3.png', line: 'black' },
  { bg: '#0E0E10', src: '/upload-tiles/4.png', line: 'white' },
  {
    bg: 'linear-gradient(135deg, #F5C8E0 0%, #E8A8C4 45%, #FF9A6B 100%)',
    src: '/upload-tiles/5.png',
    line: 'white',
  },
  { bg: '#1B2A4A', src: '/upload-tiles/6.png', line: 'white' },
  { bg: '#FFB5A8', src: '/upload-tiles/7.png', line: 'black' },
  {
    bg: 'linear-gradient(180deg, #B8D8F0 0%, #E8F0F8 100%)',
    src: '/upload-tiles/8.png',
    line: 'black',
  },
];
