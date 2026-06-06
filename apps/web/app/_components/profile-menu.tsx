'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { logout } from '../login/actions';
import { SettingsModal } from './settings-modal';

export type ProfileUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: string | null;
};

export function ProfileMenu({ user }: { user: ProfileUser }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl);
  const [uploading, setUploading] = useState(false);

  // 메뉴 외부 클릭 시 닫기 — 메뉴 내부 클릭으로 모달이 열리는 시점에도 닫히도록.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const displayName = user.displayName ?? user.email?.split('@')[0] ?? '사용자';
  const initial = (displayName.charAt(0) || 'S').toUpperCase();

  async function handleAvatarPick(file: File) {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const supabase = createClient();
      // 확장자 정규화 — content-type 에 가까운 확장자만 허용.
      const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data: publicData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = publicData.publicUrl;
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);
      if (updateError) throw updateError;
      setAvatarUrl(publicUrl);
      router.refresh();
    } catch (err) {
      console.error('avatar upload failed', err);
      alert('아바타 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div ref={containerRef} className="relative flex min-w-0 flex-1 items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-left hover:bg-black/[0.04]"
        aria-label="사용자 메뉴"
        aria-expanded={open}
      >
        {/* 아바타(28px)의 중심을 아래 nav 아이콘(16px) 중심선과 맞춘다.
            nav 아이콘 중심 = px-2(8)+px-3(12)+8 = 28px. 아바타 중심을 28px에 두려면
            왼쪽 끝이 14px여야 하고, 버튼 콘텐츠 시작점 20px 기준 -6px → -ml-1.5. */}
        <span className="-ml-1.5 shrink-0">
          <Avatar src={avatarUrl} initial={initial} size={28} />
        </span>
        <span className="truncate text-[13px] font-medium tracking-tight text-[#1E1E1E]">
          {displayName}
        </span>
        <ChevronDownIcon className="h-3 w-3 shrink-0 text-[#A3A3A3]" />
      </button>

      {open ? (
        <div
          className="absolute left-0 top-11 z-50 w-[244px] overflow-hidden rounded-xl bg-[#1E1E1E] text-white shadow-2xl ring-1 ring-black/40"
          role="menu"
        >
          {/* 헤더: 아바타 + 이름 + 이메일 */}
          <div className="flex flex-col items-center gap-2 px-4 pb-4 pt-5">
            <div className="relative">
              <Avatar src={avatarUrl} initial={initial} size={56} dark />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#2C2C2C] text-white ring-2 ring-[#1E1E1E] hover:bg-[#3A3A3A] disabled:opacity-50"
                aria-label="프로필 사진 변경"
              >
                <PencilIcon className="h-3 w-3" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleAvatarPick(f);
                  e.target.value = '';
                }}
              />
            </div>
            <div className="flex flex-col items-center gap-0.5 pt-1">
              <span className="text-[14px] font-medium tracking-tight text-white">
                {displayName}
              </span>
              <span className="text-[12px] tracking-tight text-[#A3A3A3]">
                {user.email ?? ''}
              </span>
            </div>
          </div>

          <Divider />

          <MenuItem
            icon={<SettingsIcon className="h-[15px] w-[15px]" />}
            label="설정"
            onClick={() => {
              setOpen(false);
              setSettingsOpen(true);
            }}
          />

          <Divider />

          <MenuItem
            icon={<PlusIcon className="h-[15px] w-[15px]" />}
            label="계정 추가"
            onClick={() => {
              setOpen(false);
              // 다른 계정으로 로그인 — 로그인 페이지로 이동(현재 세션 유지).
              router.push('/login?mode=login');
            }}
          />

          <Divider />

          <form action={logout}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] tracking-tight text-white hover:bg-white/[0.06]"
            >
              <LogoutIcon className="h-[15px] w-[15px]" />
              <span>로그아웃</span>
            </button>
          </form>
        </div>
      ) : null}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={{ ...user, avatarUrl }}
        onAvatarChange={(url) => setAvatarUrl(url)}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] tracking-tight text-white hover:bg-white/[0.06]"
      role="menuitem"
    >
      <span className="text-[#D4D4D4]">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function Divider() {
  return <div className="h-px w-full bg-white/[0.08]" />;
}

function Avatar({
  src,
  initial,
  size,
  dark = false,
}: {
  src: string | null;
  initial: string;
  size: number;
  dark?: boolean;
}) {
  const fontSize = Math.round(size * 0.42);
  if (src) {
    return (
      // 단순 표시용. priority 가 필요 없고, public URL 도메인이 변동 가능해 next/image 대신 img 사용.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-medium ${
        dark ? 'bg-black text-white' : 'bg-black text-white'
      }`}
      style={{ width: size, height: size, fontSize }}
    >
      {initial}
    </span>
  );
}

function ChevronDownIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PencilIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path
        d="M2.8 12.2 3 13l.8.2 7.5-7.5-1-1L2.8 12.2Z"
        strokeLinejoin="round"
      />
      <path d="m10.5 5 1 1 1.4-1.4a.7.7 0 0 0 0-1L12 2.7a.7.7 0 0 0-1 0L9.5 4l1 1Z" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
      <circle cx="8" cy="8" r="2" />
      <path
        d="M13 8c0-.3 0-.6-.07-.9l1.5-1.16-1.5-2.6-1.78.7a4.6 4.6 0 0 0-1.55-.9L9.3 1H6.7l-.3 2.14c-.56.22-1.08.52-1.55.9l-1.78-.7-1.5 2.6 1.5 1.16C3.03 7.4 3 7.7 3 8s.03.6.07.9L1.57 10.06l1.5 2.6 1.78-.7c.47.38.99.68 1.55.9l.3 2.14h2.6l.3-2.14a4.6 4.6 0 0 0 1.55-.9l1.78.7 1.5-2.6-1.5-1.16c.04-.3.07-.6.07-.9Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" />
    </svg>
  );
}

function LogoutIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
      <path d="M9.5 3.5h-5A1.5 1.5 0 0 0 3 5v6a1.5 1.5 0 0 0 1.5 1.5h5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m11 5.5 2.5 2.5L11 10.5M13.3 8H6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
