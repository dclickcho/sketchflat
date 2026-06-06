'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -80px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

function revealClass(shown: boolean) {
  return [
    'transition-all duration-700 ease-out',
    shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3',
  ].join(' ');
}

export function LandingPage() {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const update = () => {
      setScale(Math.min(1, window.innerWidth / 1920));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const hero = useReveal<HTMLDivElement>();
  const gen = useReveal<HTMLDivElement>();
  const edit = useReveal<HTMLDivElement>();
  const lib = useReveal<HTMLDivElement>();
  const cta = useReveal<HTMLDivElement>();

  return (
    <div
      className="relative w-full overflow-hidden bg-[#FAFAF8] flex justify-center"
      style={{ height: 4944.59 * scale }}
    >
      <div
        className="relative origin-top-left bg-[#FAFAF8]"
        style={{
          width: 1920,
          height: 4944.59,
          transform: `scale(${scale})`,
        }}
      >
        <div className="w-[1920px] h-[4944.59px] left-0 top-0 absolute">
          {/* MAIN BODY */}
          <div className="w-[1920px] h-[4641.59px] left-0 top-[57px] absolute">
            {/* SECTION 1 — HERO */}
            <div ref={hero.ref} className={`w-[1280px] h-[1097.59px] left-[320px] top-0 absolute bg-[#FAFAF8] border-l border-r border-gray-200 ${revealClass(hero.shown)}`}>
              <div className="left-[299px] top-[192.20px] absolute text-center text-neutral-500 text-lg font-normal leading-5">Foundational models for</div>
              <div className="w-[1108px] h-16 left-[87px] top-[96px] absolute text-center text-stone-900 text-7xl font-medium leading-[72px]">Frontier AI for Fashion Design</div>

              {/* Generating chip */}
              <div className="w-28 h-8 left-[504px] top-[188px] absolute bg-white rounded-xl flex items-center pl-1 pr-3 gap-2 shadow-[0px_1px_0px_0px_rgba(0,0,0,0.05),0px_0px_0px_1px_rgba(235,235,235,1)]">
                <span className="flex items-center justify-center bg-stone-50 rounded-lg w-6 h-6">
                  <span className="flex items-center justify-center bg-white rounded-md w-5 h-5 shadow-[0px_0px_0px_1px_rgba(235,235,235,1)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/landing/chip-generate-icon.svg" alt="" className="w-4 h-5 object-contain" />
                  </span>
                </span>
                <span className="text-zinc-800 text-sm font-medium leading-4">Generating</span>
              </div>

              <div className="left-[622px] top-[192.20px] absolute text-center text-neutral-500 text-lg font-normal leading-5">,</div>

              {/* Editing chip */}
              <div className="w-20 h-8 left-[634px] top-[188px] absolute bg-white rounded-xl flex items-center pl-1 pr-3 gap-2 shadow-[0px_1px_0px_0px_rgba(0,0,0,0.05),0px_0px_0px_1px_rgba(235,235,235,1)]">
                <span className="flex items-center justify-center bg-stone-50 rounded-lg w-6 h-6">
                  <span className="flex items-center justify-center bg-white rounded-md w-5 h-5 shadow-[0px_0px_0px_1px_rgba(235,235,235,1)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/landing/chip-edit-icon.svg" alt="" className="w-4 h-5 object-contain" />
                  </span>
                </span>
                <span className="text-zinc-800 text-sm font-medium leading-4">Editing</span>
              </div>

              <div className="left-[726px] top-[192.20px] absolute text-center text-neutral-500 text-lg font-normal leading-5">, and</div>

              {/* Remixing chip */}
              <div className="w-24 h-8 left-[772px] top-[188px] absolute bg-white rounded-xl flex items-center pl-1 pr-3 gap-2 shadow-[0px_1px_0px_0px_rgba(0,0,0,0.05),0px_0px_0px_1px_rgba(235,235,235,1)]">
                <span className="flex items-center justify-center bg-stone-50 rounded-lg w-6 h-6">
                  <span className="flex items-center justify-center bg-white rounded-md w-5 h-5 shadow-[0px_0px_0px_1px_rgba(235,235,235,1)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/landing/chip-remix-icon.svg" alt="" className="w-4 h-5 object-contain" />
                  </span>
                </span>
                <span className="text-zinc-800 text-sm font-medium leading-4">Remixing</span>
              </div>

              <div className="left-[879px] top-[192.20px] absolute text-center text-neutral-500 text-lg font-normal leading-5">fashion flats.</div>
              <div className="left-[476px] top-[235px] absolute text-center text-neutral-500 text-lg font-normal leading-5">From a single photo to a clean vector flat.</div>

              <Link
                href="/login?mode=signup"
                className="w-36 h-12 left-[485.28px] top-[289.59px] absolute bg-zinc-800 rounded-full hover:opacity-90 transition-opacity flex items-center justify-center"
              >
                <span className="text-white text-base font-medium leading-5">Start creating</span>
              </Link>
              <a
                href="#generation"
                className="w-40 h-12 left-[636.36px] top-[289.59px] absolute bg-white rounded-full hover:bg-neutral-50 transition-colors flex items-center justify-center shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05),0px_0px_0px_1px_rgba(20,20,20,0.10)]"
              >
                <span className="text-zinc-800 text-base font-medium leading-5">Explore More</span>
              </a>

              <div className="w-[1278px] h-[568px] left-[1px] top-[401.59px] absolute">
                <div className="w-[1278px] h-96 left-0 top-[189.33px] absolute border-t border-b border-gray-200" />
                <div className="w-[806px] h-[455px] left-[236px] top-[13.41px] absolute bg-white rounded-tl-xl rounded-tr-xl shadow-[0px_8px_16px_0px_rgba(51,51,51,0.04),0px_0px_0px_1px_rgba(20,20,20,0.10)] overflow-hidden">
                  <div className="w-[806px] h-9 left-0 top-0 absolute border-b border-neutral-900/10">
                    <div className="size-2.5 left-[12px] top-[12.50px] absolute bg-gray-200 rounded-full" />
                    <div className="size-2.5 left-[28px] top-[12.50px] absolute bg-gray-200 rounded-full" />
                    <div className="size-2.5 left-[44px] top-[12.50px] absolute bg-gray-200 rounded-full" />
                    <div className="w-24 h-4 left-[354px] top-[9.41px] absolute text-center text-neutral-500 text-xs font-medium leading-4">SketchFlat</div>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="w-[803px] h-[419px] left-[3px] top-[36px] absolute object-contain" src="/landing/hero-preview.png" alt="SketchFlat editor preview" />
                </div>
              </div>
            </div>

            {/* SECTION 2 — AI GENERATION */}
            <div ref={gen.ref} id="generation" className={`w-[1280px] h-[920px] left-[320px] top-[1097.59px] absolute bg-[#FAFAF8] border-l border-r border-gray-200 ${revealClass(gen.shown)}`}>
              <div className="w-[1280px] left-0 top-[96px] absolute text-center text-neutral-900 text-sm font-medium tracking-wider">AI GENERATION</div>
              <div className="w-[1100px] left-[90px] top-[128px] absolute text-center text-neutral-900 text-4xl font-medium leading-[48px]">One photo. One clean vector flat.</div>
              <div className="w-[800px] left-[240px] top-[192px] absolute text-center text-neutral-500 text-lg font-normal leading-7">Output arrives as grouped vector layers — body, sleeves, collar, placket, and more</div>
              <div className="left-[658px] top-[542.41px] absolute text-zinc-600 text-4xl font-medium">→</div>
              <div className="w-[420px] h-[420px] left-[740px] top-[361.41px] absolute bg-white rounded-2xl shadow-[0px_14px_32px_0px_rgba(0,0,0,0.10),0px_32px_64px_0px_rgba(0,0,0,0.06)] outline outline-1 outline-offset-[-1px] outline-neutral-300 overflow-hidden">
                <div className="w-[420px] h-10 left-0 top-0 absolute bg-stone-50" />
                <div className="w-[420px] h-px left-0 top-[40px] absolute bg-gray-200" />
                <div className="size-2.5 left-[16px] top-[14px] absolute bg-neutral-300 rounded-full" />
                <div className="size-2.5 left-[34px] top-[14px] absolute bg-neutral-300 rounded-full" />
                <div className="size-2.5 left-[52px] top-[14px] absolute bg-neutral-300 rounded-full" />
                <div className="left-[176px] top-[13px] absolute text-neutral-500 text-xs font-medium">Sketchpack</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="w-[321px] h-[336px] left-[50px] top-[62px] absolute rounded-sm object-cover" src="/landing/gen-output-shirt.png" alt="Generated vector flat" />
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="w-[492px] h-[202px] left-[120px] top-[470.41px] absolute rounded-xl shadow-[0px_8px_24px_0px_rgba(0,0,0,0.06)] object-cover" src="/landing/gen-input-ui.png" alt="Image input UI" />
              <div className="w-[220px] h-[252px] left-[340px] top-[297.41px] absolute origin-top-left -rotate-6 bg-white rounded-lg shadow-[0px_16px_36px_0px_rgba(0,0,0,0.18),0px_4px_8px_0px_rgba(0,0,0,0.10)] outline outline-1 outline-offset-[-1px] outline-gray-200 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="w-[200px] h-[210px] left-[9px] top-[9px] absolute rounded-sm object-cover" src="/landing/gen-polaroid.png" alt="Reference photo" />
              </div>
            </div>

            {/* SECTION 3 — VECTOR EDITING */}
            <div ref={edit.ref} className={`w-[1280px] h-[920px] left-[320px] top-[2017.59px] absolute bg-[#FAFAF8] border-l border-r border-gray-200 ${revealClass(edit.shown)}`}>
              <div className="w-96 left-[80px] top-[360.41px] absolute text-neutral-900 text-sm font-medium tracking-wider">VECTOR EDITING</div>
              <div className="w-96 left-[80px] top-[392.41px] absolute text-neutral-900 text-4xl font-medium leading-[48px]">Edit every layer,<br/>path, and anchor.</div>
              <div className="w-[721px] h-[578px] left-[479px] top-[135.41px] absolute rounded-2xl shadow-[0px_12px_32px_0px_rgba(0,0,0,0.06)] border border-gray-200 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="absolute max-w-none"
                  style={{ width: '118.72%', height: '97.26%', left: '-0.04%', top: '0.7%' }}
                  src="/landing/editor-mockup.png"
                  alt="Vector editor preview"
                />
              </div>
            </div>

            {/* SECTION 4 — PARTS LIBRARY */}
            <div ref={lib.ref} className={`w-[1280px] h-[920px] left-[320px] top-[2938px] absolute bg-[#FAFAF8] overflow-hidden border-l border-r border-gray-200 ${revealClass(lib.shown)}`}>
              <div className="w-[1280px] left-0 top-[96px] absolute text-center text-neutral-900 text-sm font-medium tracking-wider">PARTS LIBRARY</div>
              <div className="w-[1280px] left-0 top-[128px] absolute text-center text-neutral-900 text-4xl font-medium leading-[48px]">Save it once. Reuse it forever.</div>
              <div className="w-[1280px] h-[580px] left-0 top-[241.41px] absolute overflow-hidden">
                <div className="w-10 h-px left-[488px] top-[290px] absolute bg-zinc-300" />
                <div className="w-8 h-[0.84px] left-[690.05px] top-[289.94px] absolute bg-zinc-300" />
                <div className="w-8 h-[0.84px] left-[556px] top-[289.94px] absolute bg-zinc-300" />
                <div className="w-12 h-7 left-[614.65px] top-[276.54px] absolute bg-neutral-900 rounded-2xl overflow-hidden flex items-center justify-center">
                  <span className="text-white text-xs font-medium">Drop</span>
                </div>
                <div className="w-[514px] h-[357px] left-[37px] top-[106.29px] absolute rounded-2xl shadow-[0px_8px_24px_0px_rgba(0,0,0,0.05)] outline outline-1 outline-offset-[-1px] outline-gray-200 overflow-hidden bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="absolute inset-0 w-full h-full object-cover" src="/landing/lib-panel.png" alt="Parts library panel" />
                </div>
                <div className="w-[514px] h-[441px] left-[732px] top-[69.59px] absolute bg-white rounded-2xl shadow-[0px_8px_24px_0px_rgba(0,0,0,0.05)] outline outline-1 outline-offset-[-1px] outline-gray-200 overflow-hidden">
                  <div className="w-[620px] h-9 left-0 top-0 absolute bg-zinc-100 overflow-hidden">
                    <div className="size-2.5 left-[14px] top-[13px] absolute bg-red-400 rounded-full" />
                    <div className="size-2.5 left-[30px] top-[13px] absolute bg-amber-300 rounded-full" />
                    <div className="size-2.5 left-[46px] top-[13px] absolute bg-green-400 rounded-full" />
                  </div>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="w-[471.1px] h-[413.351px] left-[753px] top-[96.94px] absolute object-contain" src="/landing/lib-canvas-shirt.png" alt="Working canvas" />
              </div>
            </div>

            {/* SECTION 5 — CTA */}
            <div ref={cta.ref} className={`w-[1280px] h-[744px] left-[320px] top-[3897.59px] absolute border-l border-r border-gray-200 ${revealClass(cta.shown)}`}>
              <div className="w-[1278px] h-[360px] left-[1px] top-[128px] absolute border-t border-b border-gray-200 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/landing/cta-grid-bg.svg"
                  alt=""
                  aria-hidden
                  className="absolute left-0 top-0 w-full h-full object-cover pointer-events-none"
                />
                <div className="w-[1100px] left-[89px] top-[93.41px] absolute text-center text-neutral-900 text-3xl font-medium leading-10">Let&apos;s build the next generation of fashion design tools</div>
                <Link
                  href="/login?mode=signup"
                  className="w-36 h-12 left-[499px] top-[168px] absolute bg-zinc-800 rounded-full hover:opacity-90 transition-opacity flex items-center justify-center"
                >
                  <span className="text-white text-base font-medium leading-5">Get started</span>
                </Link>
                <Link
                  href="/login"
                  className="w-28 h-12 left-[661px] top-[168px] absolute bg-white rounded-full hover:bg-neutral-50 transition-colors flex items-center justify-center shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05),0px_0px_0px_1px_rgba(20,20,20,0.10)]"
                >
                  <span className="text-zinc-800 text-base font-medium leading-5">Sign In</span>
                </Link>
              </div>
            </div>
          </div>

          {/* FOOTER */}
          <div className="w-[1920px] h-60 left-0 top-[4698.59px] absolute">
            <div className="w-[1920px] h-px left-0 top-0 absolute bg-gray-200" />
            <div className="w-[1280px] h-72 left-[320px] top-0 absolute border-l border-r border-t border-gray-200">
              <Link
                href="/"
                className="absolute left-[29px] top-[57.41px] w-4 h-[22px]"
                aria-label="SketchFlat"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/landing/sketchflat-logo-footer.svg" alt="SketchFlat" className="w-full h-full" />
              </Link>
              <div className="w-44 h-40 left-[235.33px] top-[57px] absolute">
                <div className="absolute left-0 top-0 text-neutral-600 text-xs font-medium uppercase leading-4 tracking-wide">Features</div>
                <div className="absolute left-0 top-[34.41px] text-neutral-500 text-sm leading-7">AI Generation</div>
                <div className="absolute left-0 top-[70.41px] text-neutral-500 text-sm leading-7">Vector Editing</div>
                <div className="absolute left-0 top-[106.41px] text-neutral-500 text-sm leading-7">Parts Library</div>
                <div className="absolute left-0 top-[142.41px] text-neutral-500 text-sm leading-7">Tech Packs</div>
              </div>
              <div className="w-44 h-40 left-[445.66px] top-[57px] absolute">
                <div className="absolute left-0 top-0 text-neutral-600 text-xs font-medium uppercase leading-4 tracking-wide">Product</div>
                <div className="absolute left-0 top-[34.41px] text-neutral-500 text-sm leading-7">Pricing</div>
                <div className="absolute left-0 top-[70.41px] text-neutral-500 text-sm leading-7">Changelog</div>
                <div className="absolute left-0 top-[106.41px] text-neutral-500 text-sm leading-7">Roadmap</div>
              </div>
              <div className="w-44 h-40 left-[655.98px] top-[57px] absolute">
                <div className="absolute left-0 top-0 text-neutral-600 text-xs font-medium uppercase leading-4 tracking-wide">Company</div>
                <div className="absolute left-0 top-[34.41px] text-neutral-500 text-sm leading-7">About</div>
                <div className="absolute left-0 top-[70.41px] text-neutral-500 text-sm leading-7">Careers</div>
              </div>
              <div className="w-44 h-40 left-[866.33px] top-[57px] absolute">
                <div className="absolute left-0 top-0 text-neutral-600 text-xs font-medium uppercase leading-4 tracking-wide">Resources</div>
                <div className="absolute left-0 top-[34.41px] text-neutral-500 text-sm leading-7">Help Center</div>
                <div className="absolute left-0 top-[70.41px] text-neutral-500 text-sm leading-7">Documentation</div>
                <div className="absolute left-0 top-[106.41px] text-neutral-500 text-sm leading-7">Terms of service</div>
                <div className="absolute left-0 top-[142.41px] text-neutral-500 text-sm leading-7">Privacy policy</div>
              </div>
              <div className="w-44 h-40 left-[1076.66px] top-[57px] absolute">
                <div className="absolute left-0 top-0 text-neutral-600 text-xs font-medium uppercase leading-4 tracking-wide">Connect</div>
                <div className="absolute left-0 top-[34.41px] text-neutral-500 text-sm leading-7">X (Twitter)</div>
                <div className="absolute left-0 top-[70.41px] text-neutral-500 text-sm leading-7">Instagram</div>
                <div className="absolute left-0 top-[106.41px] text-neutral-500 text-sm leading-7">Email</div>
              </div>
            </div>
          </div>

          {/* TOPBAR */}
          <div className="w-[1920px] h-[57px] left-0 top-0 absolute bg-[#FAFAF8]">
            <div className="w-[1920px] h-px left-0 top-[56px] absolute bg-gray-200" />
            <div className="absolute left-[319px] top-0 w-px h-[57px] bg-gray-200" />
            <div className="absolute left-[1600px] top-0 w-px h-[57px] bg-gray-200" />
            <Link
              href="/"
              className="absolute left-[342px] top-[13px] w-[106px] h-[24px]"
              aria-label="SketchFlat"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/landing/sketchflat-logo-header.svg" alt="SketchFlat" className="w-full h-full" />
            </Link>
            <nav className="absolute left-[852px] top-[20.09px] flex gap-10 text-zinc-800 text-sm font-normal leading-4">
              <a href="#generation" className="hover:text-zinc-600 transition-colors">Features</a>
              <a href="#" className="hover:text-zinc-600 transition-colors">Pricing</a>
              <a href="#" className="hover:text-zinc-600 transition-colors">Company</a>
            </nav>
            <Link
              href="/login"
              className="w-16 h-7 left-[1409.05px] top-[14.5px] absolute bg-white rounded-full hover:bg-neutral-100 transition-colors flex items-center justify-center shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05),0px_0px_0px_1px_rgba(20,20,20,0.10)]"
            >
              <span className="text-zinc-800 text-sm font-medium leading-4">Sign in</span>
            </Link>
            <Link
              href="/login?mode=signup"
              className="w-24 h-7 left-[1483.64px] top-[14.5px] absolute bg-zinc-800 rounded-full hover:opacity-90 transition-opacity flex items-center justify-center"
            >
              <span className="text-white text-sm font-medium leading-4">Get started</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
