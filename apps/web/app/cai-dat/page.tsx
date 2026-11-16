'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, type MyProfile } from '@/lib/api';
import { refresh } from '@/lib/auth';
import SignInWall from '../SignInWall';

const BIO_MAX = 300;
const NAME_MAX = 50;
const HANDLE_RE = /^[a-z0-9_]{3,24}$/;

/** What people type into a handle box, made into something that can be one. */
function cleanHandle(v: string): string {
  return v
    .replace(/^@/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[\s.-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function Settings() {
  const [me, setMe] = useState<MyProfile | null>(null);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [check, setCheck] = useState<{ handle: string; problem: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    api
      .myProfile()
      .then((p) => {
        setMe(p);
        setName(p.displayName);
        setHandle(p.handle);
        setBio(p.bio ?? '');
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Ask the server whether the handle is free, a beat after typing stops.
  useEffect(() => {
    if (!me || handle === me.handle) return setCheck(null);
    if (!HANDLE_RE.test(handle)) {
      return setCheck({ handle, problem: 'Chỉ gồm chữ thường không dấu, số và dấu _, dài 3–24 ký tự.' });
    }
    const n = ++seq.current;
    const t = setTimeout(() => {
      api
        .checkHandle(handle)
        .then((r) => n === seq.current && setCheck({ handle, problem: r.problem }))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [handle, me]);

  if (!me) {
    return error ? (
      <p className="panel text-sm text-[var(--color-son)]">{error}</p>
    ) : (
      <div className="flex flex-col gap-4">
        <div className="skeleton h-9 w-40" />
        <div className="skeleton h-40 w-full" />
      </div>
    );
  }

  const handleChanged = handle !== me.handle;
  const locked = me.nextHandleChangeAt && new Date(me.nextHandleChangeAt) > new Date();
  const dirty = name.trim() !== me.displayName || handleChanged || bio.trim() !== (me.bio ?? '');
  const handleBad = handleChanged && (!check || check.handle !== handle || check.problem !== null);
  const canSave = dirty && !saving && name.trim().length > 0 && bio.length <= BIO_MAX && !handleBad;

  async function save() {
    if (!me) return;
    setSaving(true);
    setError(null);
    try {
      const p = await api.updateProfile({
        ...(name.trim() !== me.displayName ? { displayName: name } : {}),
        ...(handleChanged ? { handle } : {}),
        ...(bio.trim() !== (me.bio ?? '') ? { bio: bio.trim() || null } : {}),
      });
      setMe(p);
      setName(p.displayName);
      setHandle(p.handle);
      setBio(p.bio ?? '');
      // The header reads the signed-in user from the session; a refresh
      // reissues it with the new name and handle.
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void save();
      }}
    >
      <section className="card flex flex-col gap-6 p-6 sm:p-7">
        <div className="flex items-center gap-4">
          {me.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={me.avatarUrl}
              alt=""
              width={56}
              height={56}
              referrerPolicy="no-referrer"
              className="h-14 w-14 rounded-full object-cover"
            />
          ) : (
            <span className="grid h-14 w-14 place-items-center rounded-full border border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] text-[18px] text-[var(--color-accent)]">
              {(name.trim()[0] ?? '?').toUpperCase()}
            </span>
          )}
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[16px] font-medium">{name.trim() || '—'}</span>
            <span className="truncate text-[13px] text-[var(--color-muted)]">@{handle || '…'}</span>
          </div>
          <Link href={`/u/${me.handle}`} className="btn btn-ghost btn-sm ml-auto">
            Xem trang của tôi
          </Link>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="label">Tên hiển thị</span>
          <input
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            className="field"
            autoComplete="name"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="label">Username</span>
          <div className="flex items-center rounded-[var(--radius-md)] border border-[var(--color-line)] focus-within:border-[var(--color-accent-line)]">
            <span className="pl-3 text-[14.5px] text-[var(--color-faint)]">@</span>
            <input
              value={handle}
              maxLength={24}
              disabled={!!locked}
              onChange={(e) => setHandle(cleanHandle(e.target.value))}
              className="field border-0 pl-1 focus:outline-none"
              autoComplete="username"
              spellCheck={false}
            />
          </div>
          <span
            className={`text-[12.5px] ${
              handleChanged && check?.problem ? 'text-[var(--color-son)]' : 'text-[var(--color-faint)]'
            }`}
          >
            {locked
              ? `Bạn vừa đổi username. Có thể đổi lại từ ${new Date(me.nextHandleChangeAt!).toLocaleDateString('vi-VN')}.`
              : !handleChanged
                ? 'Mọi người nhắc đến bạn bằng tên này, ví dụ khi mời vào phòng viết. Đổi xong phải đợi 14 ngày mới đổi lại được.'
                : !check || check.handle !== handle
                  ? 'Đang kiểm tra…'
                  : check.problem ?? `@${handle} dùng được. Liên kết cũ tới trang của bạn sẽ không còn chạy.`}
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between">
            <span className="label">Giới thiệu</span>
            <span
              className={`text-[11.5px] tabular-nums ${
                bio.length > BIO_MAX ? 'text-[var(--color-son)]' : 'text-[var(--color-faint)]'
              }`}
            >
              {bio.length}/{BIO_MAX}
            </span>
          </span>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            placeholder="Vài dòng về bạn: thích đọc gì, viết gì, sợ gì nhất…"
            className="field resize-y leading-relaxed"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="label">Email</span>
          <span className="text-[14px] text-[var(--color-muted)]">
            {me.email} <span className="text-[var(--color-faint)]">· chỉ mình bạn thấy, lấy từ tài khoản Google</span>
          </span>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!canSave} className="btn btn-primary">
          {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
        </button>
        {dirty && !saving && (
          <button
            type="button"
            onClick={() => {
              setName(me.displayName);
              setHandle(me.handle);
              setBio(me.bio ?? '');
            }}
            className="btn btn-quiet"
          >
            Hoàn tác
          </button>
        )}
        {saved && <span role="status" className="text-[13px] text-[var(--color-accent)]">Đã lưu ✓</span>}
        {error && <span role="alert" className="text-[13px] text-[var(--color-son)]">{error}</span>}
      </div>
    </form>
  );
}

export default function SettingsPage() {
  return (
    <main className="mx-auto flex max-w-[44rem] flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-2">
        <h1 className="display text-[2.2rem] leading-[1.05] sm:text-[2.6rem]">Cài đặt</h1>
        <p className="text-[15px] text-[var(--color-muted)]">
          Tên, username và vài dòng giới thiệu mà người đọc thấy trên trang của bạn.
        </p>
      </header>
      <SignInWall title="Cài đặt tài khoản" reason="Đăng nhập để sửa tên, username và giới thiệu của bạn.">
        <Settings />
      </SignInWall>
    </main>
  );
}
