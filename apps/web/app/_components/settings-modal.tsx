'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { ProfileUser } from './profile-menu';

type TabKey = 'account' | 'community' | 'notifications' | 'security';
type ThemeKey = 'system' | 'light' | 'dark';

// 설정 모달 — 레퍼런스(setting refer.png)에 맞춰 계정 탭 위주로 구현. 다른 탭은 placeholder.
export function SettingsModal({
  open,
  onClose,
  user,
  onAvatarChange,
}: {
  open: boolean;
  onClose: () => void;
  user: ProfileUser;
  onAvatarChange: (url: string | null) => void;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<TabKey>('account');
  const [uploading, setUploading] = useState(false);

  // 인라인 편집 상태 — 각 필드별 독립 토글.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user.displayName ?? '');
  const [savingName, setSavingName] = useState(false);

  const [editingRole, setEditingRole] = useState(false);
  const [roleDraft, setRoleDraft] = useState(user.role ?? '디자인');
  const [savingRole, setSavingRole] = useState(false);

  const [editingLang, setEditingLang] = useState(false);
  const [language, setLanguage] = useState<string>('한국어');
  const [langDraft, setLangDraft] = useState('한국어');

  const [theme, setTheme] = useState<ThemeKey>('system');

  // open 변경 시 draft 동기화. 닫혔다 다시 열리면 사용자 정보를 다시 반영한다.
  useEffect(() => {
    if (!open) return;
    setTab('account');
    setEditingName(false);
    setEditingRole(false);
    setEditingLang(false);
    setNameDraft(user.displayName ?? '');
    setRoleDraft(user.role ?? '디자인');
    setLangDraft(language);
    // localStorage 에 저장된 테마 복원.
    try {
      const saved = window.localStorage.getItem('sketchpack:theme') as ThemeKey | null;
      if (saved === 'system' || saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {
      // localStorage 사용 불가 환경 — 무시.
    }
  }, [open, user.displayName, user.role, language]);

  // ESC 닫기 + 외부 클릭 닫기는 백드롭 onClick 으로 처리.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const displayName = user.displayName ?? user.email?.split('@')[0] ?? '사용자';
  const initial = (displayName.charAt(0) || 'S').toUpperCase();
  const roleLabel = user.role && user.role.trim().length > 0 ? user.role : '디자인';

  async function handleAvatarPick(file: File) {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const supabase = createClient();
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
      onAvatarChange(publicUrl);
      router.refresh();
    } catch (err) {
      console.error('avatar upload failed', err);
      alert('아바타 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveName() {
    const next = nameDraft.trim();
    if (!next || next === user.displayName) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: next })
        .eq('id', user.id);
      if (error) throw error;
      setEditingName(false);
      router.refresh();
    } catch (err) {
      console.error('name update failed', err);
      alert('이름 변경에 실패했습니다.');
    } finally {
      setSavingName(false);
    }
  }

  async function handleSaveRole() {
    const next = roleDraft.trim();
    if (!next || next === (user.role ?? '')) {
      setEditingRole(false);
      return;
    }
    setSavingRole(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('profiles')
        .update({ role: next })
        .eq('id', user.id);
      if (error) throw error;
      setEditingRole(false);
      router.refresh();
    } catch (err) {
      console.error('role update failed', err);
      alert('역할 변경에 실패했습니다.');
    } finally {
      setSavingRole(false);
    }
  }

  function handleSaveLanguage() {
    const next = langDraft.trim();
    if (next) setLanguage(next);
    setEditingLang(false);
  }

  function handleThemeChange(next: ThemeKey) {
    setTheme(next);
    try {
      window.localStorage.setItem('sketchpack:theme', next);
    } catch {
      // 저장 실패는 무시 — 시각적 토글 데모용.
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-6"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white text-[#1E1E1E] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="설정"
      >
        {/* 상단 탭 헤더 */}
        <div className="flex items-center justify-between border-b border-[#EAEAEA] px-5">
          <div className="flex items-center gap-1">
            <TabButton active={tab === 'account'} onClick={() => setTab('account')}>계정</TabButton>
            <TabButton active={tab === 'community'} onClick={() => setTab('community')}>커뮤니티</TabButton>
            <TabButton active={tab === 'notifications'} onClick={() => setTab('notifications')}>알림</TabButton>
            <TabButton active={tab === 'security'} onClick={() => setTab('security')}>보안</TabButton>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-[#737373] hover:bg-black/[0.06]"
            aria-label="닫기"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 본문 — 스크롤 가능 */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'account' ? (
            <AccountTab
              user={user}
              displayName={displayName}
              initial={initial}
              roleLabel={roleLabel}
              language={language}
              theme={theme}
              uploading={uploading}
              editingName={editingName}
              nameDraft={nameDraft}
              savingName={savingName}
              onEditNameStart={() => {
                setNameDraft(user.displayName ?? '');
                setEditingName(true);
              }}
              onNameDraftChange={setNameDraft}
              onSaveName={handleSaveName}
              onCancelName={() => setEditingName(false)}
              editingRole={editingRole}
              roleDraft={roleDraft}
              savingRole={savingRole}
              onEditRoleStart={() => {
                setRoleDraft(user.role ?? '디자인');
                setEditingRole(true);
              }}
              onRoleDraftChange={setRoleDraft}
              onSaveRole={handleSaveRole}
              onCancelRole={() => setEditingRole(false)}
              editingLang={editingLang}
              langDraft={langDraft}
              onEditLangStart={() => {
                setLangDraft(language);
                setEditingLang(true);
              }}
              onLangDraftChange={setLangDraft}
              onSaveLang={handleSaveLanguage}
              onCancelLang={() => setEditingLang(false)}
              onThemeChange={handleThemeChange}
              onAvatarPickClick={() => fileInputRef.current?.click()}
              fileInputRef={fileInputRef}
              onFileSelected={(f) => handleAvatarPick(f)}
            />
          ) : (
            <PlaceholderTab tab={tab} />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-3 py-3 text-[13px] tracking-tight transition-colors ${
        active ? 'text-[#1E1E1E]' : 'text-[#737373] hover:text-[#1E1E1E]'
      }`}
    >
      {children}
      {/* 활성 탭 하단 검정 인디케이터 — border-b 가 컨테이너에 있으므로 절대 위치로 덮어쓴다. */}
      {active ? (
        <span className="absolute inset-x-2 -bottom-px h-[2px] bg-[#1E1E1E]" />
      ) : null}
    </button>
  );
}

function AccountTab(props: {
  user: ProfileUser;
  displayName: string;
  initial: string;
  roleLabel: string;
  language: string;
  theme: ThemeKey;
  uploading: boolean;
  editingName: boolean;
  nameDraft: string;
  savingName: boolean;
  onEditNameStart: () => void;
  onNameDraftChange: (v: string) => void;
  onSaveName: () => void;
  onCancelName: () => void;
  editingRole: boolean;
  roleDraft: string;
  savingRole: boolean;
  onEditRoleStart: () => void;
  onRoleDraftChange: (v: string) => void;
  onSaveRole: () => void;
  onCancelRole: () => void;
  editingLang: boolean;
  langDraft: string;
  onEditLangStart: () => void;
  onLangDraftChange: (v: string) => void;
  onSaveLang: () => void;
  onCancelLang: () => void;
  onThemeChange: (next: ThemeKey) => void;
  onAvatarPickClick: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileSelected: (file: File) => void;
}) {
  const {
    user,
    displayName,
    initial,
    roleLabel,
    language,
    theme,
    uploading,
    editingName,
    nameDraft,
    savingName,
    onEditNameStart,
    onNameDraftChange,
    onSaveName,
    onCancelName,
    editingRole,
    roleDraft,
    savingRole,
    onEditRoleStart,
    onRoleDraftChange,
    onSaveRole,
    onCancelRole,
    editingLang,
    langDraft,
    onEditLangStart,
    onLangDraftChange,
    onSaveLang,
    onCancelLang,
    onThemeChange,
    onAvatarPickClick,
    fileInputRef,
    onFileSelected,
  } = props;

  return (
    <div className="grid grid-cols-[200px_1fr] gap-8 px-8 py-8">
      {/* 좌측: 아바타 + 편집 */}
      <div className="flex flex-col items-center">
        <BigAvatar src={user.avatarUrl} initial={initial} />
        <button
          type="button"
          onClick={onAvatarPickClick}
          disabled={uploading}
          className="mt-3 text-[13px] tracking-tight text-[#1E1E1E] hover:underline disabled:opacity-50"
        >
          {uploading ? '업로드 중...' : '편집'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFileSelected(f);
            e.target.value = '';
          }}
        />
      </div>

      {/* 우측: 필드들 */}
      <div className="flex flex-col">
        {/* 이름 */}
        <FieldBlock label="이름">
          {editingName ? (
            <InlineEdit
              value={nameDraft}
              onChange={onNameDraftChange}
              onSave={onSaveName}
              onCancel={onCancelName}
              saving={savingName}
              placeholder="이름을 입력하세요"
            />
          ) : (
            <>
              <div className="text-[13px] text-[#1E1E1E]">{displayName}</div>
              <button
                type="button"
                onClick={onEditNameStart}
                className="mt-1.5 text-[13px] text-[#3B82F6] hover:underline"
              >
                이름 변경하기
              </button>
            </>
          )}
        </FieldBlock>

        {/* 이메일 */}
        <FieldBlock label="이메일">
          <div className="text-[13px] text-[#1E1E1E]">{user.email ?? ''}</div>
          <div className="mt-1.5 text-[13px] text-[#A3A3A3]">Google에서 관리됨</div>
        </FieldBlock>

        {/* 역할 */}
        <FieldBlock label="역할">
          {editingRole ? (
            <InlineEdit
              value={roleDraft}
              onChange={onRoleDraftChange}
              onSave={onSaveRole}
              onCancel={onCancelRole}
              saving={savingRole}
              placeholder="역할을 입력하세요"
            />
          ) : (
            <>
              <div className="text-[13px] text-[#1E1E1E]">{roleLabel}</div>
              <button
                type="button"
                onClick={onEditRoleStart}
                className="mt-1.5 text-[13px] text-[#3B82F6] hover:underline"
              >
                역할 변경
              </button>
            </>
          )}
        </FieldBlock>

        <Divider />

        {/* 나의 공간 */}
        <FieldBlock label="나의 공간">
          <p className="text-[13px] text-[#1E1E1E]">
            각 시트에 어떤 제품이 포함되어 있는지{' '}
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="text-[#3B82F6] hover:underline"
            >
              알아보기
            </a>
            .
          </p>
        </FieldBlock>

        <Divider />

        {/* 언어 */}
        <FieldBlock label="언어">
          {editingLang ? (
            <InlineEdit
              value={langDraft}
              onChange={onLangDraftChange}
              onSave={onSaveLang}
              onCancel={onCancelLang}
              saving={false}
              placeholder="언어 (예: 한국어)"
            />
          ) : (
            <>
              <div className="text-[13px] text-[#1E1E1E]">{language}</div>
              <button
                type="button"
                onClick={onEditLangStart}
                className="mt-1.5 text-[13px] text-[#3B82F6] hover:underline"
              >
                언어 변경
              </button>
            </>
          )}
        </FieldBlock>

        <Divider />

        {/* 테마 */}
        <FieldBlock label="테마">
          <div className="relative inline-block">
            <select
              value={theme}
              onChange={(e) => onThemeChange(e.target.value as ThemeKey)}
              className="appearance-none rounded-md border border-[#EAEAEA] bg-white py-1.5 pl-3 pr-8 text-[13px] text-[#1E1E1E] hover:border-[#D4D4D4] focus:outline-none focus:ring-1 focus:ring-[#1E1E1E]"
            >
              <option value="system">시스템 테마</option>
              <option value="light">라이트</option>
              <option value="dark">다크</option>
            </select>
            <svg
              viewBox="0 0 16 16"
              className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#737373]"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </FieldBlock>
      </div>
    </div>
  );
}

function PlaceholderTab({ tab }: { tab: TabKey }) {
  const label =
    tab === 'community' ? '커뮤니티' : tab === 'notifications' ? '알림' : '보안';
  return (
    <div className="flex min-h-[320px] items-center justify-center px-8 py-16">
      <p className="text-[13px] text-[#A3A3A3]">{label} 설정은 준비 중입니다.</p>
    </div>
  );
}

function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-4 first:pt-0">
      <div className="mb-2 text-[14px] tracking-tight text-[#1E1E1E]">{label}</div>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="my-1 h-px w-full bg-[#EAEAEA]" />;
}

function InlineEdit({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={placeholder}
        autoFocus
        disabled={saving}
        className="flex-1 rounded-md border border-[#EAEAEA] bg-white px-2.5 py-1.5 text-[13px] text-[#1E1E1E] focus:border-[#1E1E1E] focus:outline-none disabled:opacity-50"
      />
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-md bg-[#1E1E1E] px-3 py-1.5 text-[12px] text-white hover:bg-[#2C2C2C] disabled:opacity-50"
      >
        {saving ? '저장 중...' : '저장'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="rounded-md border border-[#EAEAEA] px-3 py-1.5 text-[12px] text-[#1E1E1E] hover:bg-black/[0.04] disabled:opacity-50"
      >
        취소
      </button>
    </div>
  );
}

function BigAvatar({ src, initial }: { src: string | null; initial: string }) {
  const size = 140;
  if (src) {
    return (
      // 단순 표시용 — next/image 도메인 화이트리스트 회피.
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
      className="flex shrink-0 items-center justify-center rounded-full bg-black font-medium text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {initial}
    </span>
  );
}
