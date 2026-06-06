export function HomeTopbar({ title }: { title?: string }) {
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-[#EAEAEA] bg-white text-[#1E1E1E]">
      {/* 아래 프로젝트 그리드와 동일한 컨테이너로 감싸 타이틀 좌측 시작점을 카드와 정렬한다. */}
      <div className="mx-auto flex w-full max-w-[1680px] items-center gap-3 px-9">
        {title ? (
          <h1 className="text-[14px] font-medium tracking-tight text-[#1E1E1E]">
            {title}
          </h1>
        ) : null}
      </div>
    </header>
  );
}
