'use client';

import { useEffect, useState } from 'react';
import { api, type AdminPayments, type AdminStats } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';

/**
 * Is anyone using the site? The trial deployment becomes a paid one at
 * twenty returning readers, so that number leads; the rest says where the
 * activity is.
 *
 * Not linked from anywhere. Anyone but an admin gets a plain "not found".
 */
export default function AdminPage() {
  const { user, ready } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ready || user?.role !== 'ADMIN') return;
    api.adminStats().then(setStats, () => setFailed(true));
  }, [ready, user]);

  if (!ready) return null;
  if (user?.role !== 'ADMIN' || failed) {
    return <p className="py-16 text-center text-[var(--color-muted)]">Không tìm thấy trang.</p>;
  }
  if (!stats) return <p className="py-16 text-center text-[var(--color-muted)]">Đang tải…</p>;

  const pct = Math.min(100, Math.round((stats.returning / stats.goal) * 100));
  const reached = stats.returning >= stats.goal;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="display text-3xl">Quản trị</h1>
        <p className="text-[13px] text-[var(--color-muted)]">Không tính tài khoản admin và tài khoản mẫu.</p>
      </header>

      <section className="card flex flex-col gap-3 p-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[14px] font-medium">Người dùng quay lại</h2>
          <span className="text-[12.5px] text-[var(--color-muted)]">mục tiêu {stats.goal}</span>
        </div>
        <p className="display text-5xl tabular-nums">
          {stats.returning}
          <span className="text-2xl text-[var(--color-muted)]"> / {stats.goal}</span>
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--color-line)]" role="progressbar" aria-valuenow={stats.returning} aria-valuemin={0} aria-valuemax={stats.goal} aria-label="Tiến độ tới mục tiêu">
          <div className="h-full rounded-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[12.5px] leading-relaxed text-[var(--color-muted)]">
          {reached
            ? 'Đã đạt mục tiêu: đến lúc chuyển sang máy chủ trả phí.'
            : 'Người đăng nhập vào trang ít nhất 2 ngày khác nhau trong 30 ngày qua.'}
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tài khoản" value={stats.users} note={`+${stats.newWeek} tuần này`} />
        <Stat label="Đã xác minh email" value={stats.verified} />
        <Stat label="Hoạt động hôm nay" value={stats.active.day} />
        <Stat label="Hoạt động 7 ngày" value={stats.active.week} note={`${stats.active.month} trong 30 ngày`} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-medium">7 ngày qua</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Người nghe/đọc" value={stats.week.listeners} />
          <Stat label="Bình luận" value={stats.week.comments} />
          <Stat label="Lượt theo dõi" value={stats.week.follows} />
          <Stat label="Lượt chấm điểm" value={stats.week.ratings} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-medium">Đăng ký gần đây</h2>
        {stats.signups.length === 0 ? (
          <p className="text-[13px] text-[var(--color-muted)]">Chưa có ai.</p>
        ) : (
          <ul className="card divide-y divide-[var(--color-line)]">
            {stats.signups.map((u) => (
              <li key={u.handle} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                <span className="min-w-0 truncate">
                  {u.displayName} <span className="text-[var(--color-muted)]">@{u.handle}</span>
                </span>
                <time className="flex-none tabular-nums text-[var(--color-muted)]" dateTime={u.createdAt}>
                  {new Date(u.createdAt).toLocaleDateString('vi-VN')}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Payments />
    </div>
  );
}

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

/**
 * Premium sales, and the transfers that need a hand: short payments, and
 * money that arrived without a recognisable order code. Activating attaches
 * the transfer (if one is picked) and grants the order's days once.
 */
function Payments() {
  const [data, setData] = useState<AdminPayments | null>(null);
  const [code, setCode] = useState('');
  const [transferId, setTransferId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.adminPayments().then(setData, () => setMsg('Không tải được giao dịch.'));
  useEffect(() => {
    void load();
  }, []);

  async function activate() {
    setMsg(null);
    try {
      await api.adminActivatePremium(code.trim().toUpperCase(), transferId || undefined);
      setMsg(`Đã kích hoạt ${code.trim().toUpperCase()}.`);
      setCode('');
      setTransferId('');
      await load();
    } catch (e) {
      setMsg((e as Error).message || 'Không kích hoạt được.');
    }
  }

  if (!data) return msg ? <p className="text-[13px] text-[var(--color-son)]">{msg}</p> : null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[14px] font-medium">Premium</h2>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Đang Premium" value={data.active} />
        <Stat label="Đơn đã trả" value={data.paidCount} />
        <div className="card flex flex-col gap-1 p-4">
          <span className="text-[12px] text-[var(--color-muted)]">Doanh thu</span>
          <span className="display text-2xl tabular-nums">{vnd(data.revenue)}</span>
        </div>
      </div>

      {data.orders.length > 0 && (
        <ul className="card divide-y divide-[var(--color-line)]">
          {data.orders.map((o) => (
            <li key={o.code} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
              <span className="min-w-0 truncate">
                <span className="font-mono">{o.code}</span> · {o.user.displayName}{' '}
                <span className="text-[var(--color-muted)]">@{o.user.handle}</span>
              </span>
              <span className={`tabular-nums ${o.status === 'UNDERPAID' ? 'text-[var(--color-son)]' : 'text-[var(--color-muted)]'}`}>
                {o.status === 'UNDERPAID' ? `thiếu: ${vnd(o.paidAmount)} / ${vnd(o.amount)}` : vnd(o.paidAmount)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="text-[13px] font-medium">Tiền vào không khớp đơn nào</h3>
      {data.unmatched.length === 0 ? (
        <p className="text-[13px] text-[var(--color-muted)]">Không có.</p>
      ) : (
        <ul className="card divide-y divide-[var(--color-line)]">
          {data.unmatched.map((t) => (
            <li key={t.id} className="flex flex-col gap-0.5 px-4 py-2.5 text-[13px]">
              <label className="flex items-center gap-2">
                <input type="radio" name="transfer" checked={transferId === t.id} onChange={() => setTransferId(t.id)} />
                <span className="tabular-nums font-medium">{vnd(t.amount)}</span>
                <time className="text-[var(--color-muted)]" dateTime={t.receivedAt}>
                  {new Date(t.receivedAt).toLocaleString('vi-VN')}
                </time>
              </label>
              <span className="break-all pl-6 text-[12px] text-[var(--color-muted)]">{t.content || '(không có nội dung)'}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-muted)]">
          Mã đơn của người dùng
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="NBK7Q2XM"
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-ground)] px-2 py-1.5 font-mono text-[13px] text-[var(--color-ink)]"
          />
        </label>
        <button onClick={activate} disabled={!code.trim()} className="btn btn-primary btn-sm disabled:opacity-40">
          Kích hoạt{transferId ? ' với giao dịch đã chọn' : ''}
        </button>
        {msg && <span className="text-[12.5px] text-[var(--color-muted)]">{msg}</span>}
      </div>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="text-[12px] text-[var(--color-muted)]">{label}</span>
      <span className="display text-2xl tabular-nums">{value}</span>
      {note && <span className="text-[11.5px] text-[var(--color-muted)]">{note}</span>}
    </div>
  );
}
