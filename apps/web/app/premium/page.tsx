'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type PremiumOrder, type PremiumStatus } from '@/lib/api';
import { refresh } from '@/lib/auth';
import { useAuth } from '@/lib/useAuth';
import PremiumBadge from '../PremiumBadge';

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const date = (iso: string) =>
  new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** How often the QR view asks whether the transfer has landed. */
const POLL_MS = 4000;

/**
 * Premium, sold by bank transfer: a VietQR with the order code in the
 * description, and SePay telling the server when the money arrives. There is
 * no card form and nothing to type but the bank app's own confirmation.
 */
export default function PremiumPage() {
  const { user, ready, signIn } = useAuth();
  const [status, setStatus] = useState<PremiumStatus | null>(null);
  const [order, setOrder] = useState<PremiumOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.premium().then(setStatus, () => setError('Không tải được thông tin Premium.')), []);
  useEffect(() => {
    if (ready) void load();
  }, [ready, user, load]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setOrder(await api.createPremiumOrder());
    } catch (e) {
      setError((e as Error).message || 'Không tạo được mã thanh toán. Thử lại sau ít phút.');
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !status) {
    return <p className="py-16 text-center text-[var(--color-muted)]">{error ?? 'Đang tải…'}</p>;
  }

  const p = status.perks;
  const perks = [
    { title: 'AI viết cùng nhiều hơn', free: `${p.aiFree} lượt/ngày`, paid: `${p.aiPremium} lượt/ngày` },
    { title: 'Tìm truyện bằng AI', free: `${p.searchFree} lần/ngày`, paid: `${p.searchPremium} lần/ngày` },
    { title: 'Giọng đọc ưu tiên', free: 'Xếp hàng chung', paid: 'Lên đầu hàng đợi, chương sau được tạo trước' },
    { title: 'Huy hiệu Premium', free: '—', paid: 'Cạnh tên ở trang cá nhân và bình luận' },
  ];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10 sm:px-0">
      <header className="flex flex-col gap-3">
        <PremiumBadge size="md" />
        <h1 className="display text-[2.2rem] leading-tight sm:text-[2.8rem]" style={{ textWrap: 'balance' }}>
          Nghe và viết nhiều hơn, với giá một ly trà đá.
        </h1>
        <p className="max-w-[60ch] text-[14.5px] leading-relaxed text-[var(--color-muted)]">
          <strong className="font-semibold text-[var(--color-ink)]">{vnd(status.price)}</strong> cho {status.days} ngày.
          Trả một lần bằng chuyển khoản, không tự gia hạn, không lưu thẻ. Đọc và nghe truyện vẫn miễn phí
          và không quảng cáo cho tất cả mọi người. Premium là để ủng hộ trang và dùng AI thoải mái hơn.
        </p>
      </header>

      <section aria-label="Quyền lợi" className="card overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-[11px] uppercase tracking-[0.08em] text-[var(--color-faint)]">
              <th className="px-4 py-3 font-medium" scope="col"></th>
              <th className="px-4 py-3 font-medium" scope="col">Miễn phí</th>
              <th className="px-4 py-3 font-medium text-[var(--color-accent)]" scope="col">Premium</th>
            </tr>
          </thead>
          <tbody>
            {perks.map((k) => (
              <tr key={k.title} className="border-b border-[var(--color-line)] last:border-0">
                <th scope="row" className="px-4 py-3 font-medium">{k.title}</th>
                <td className="px-4 py-3 text-[var(--color-muted)]">{k.free}</td>
                <td className="px-4 py-3">{k.paid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {status.premium && status.premiumUntil && !order && (
        <p className="rounded-[var(--radius-md)] border border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] px-4 py-3 text-[14px]">
          Bạn đang là thành viên Premium đến hết ngày <strong>{date(status.premiumUntil)}</strong>. Gia hạn bây giờ
          thì {status.days} ngày được cộng nối tiếp, không mất ngày nào.
        </p>
      )}

      {!status.enabled ? (
        <p className="text-[14px] text-[var(--color-muted)]">Premium sắp mở bán.</p>
      ) : !user ? (
        <button onClick={signIn} className="btn btn-primary self-start">
          Đăng nhập để lên Premium
        </button>
      ) : order ? (
        <Checkout
          initial={order}
          onPaid={async () => {
            await refresh();
            await load();
          }}
        />
      ) : (
        <button onClick={start} disabled={busy} className="btn btn-primary self-start disabled:opacity-50">
          {busy ? 'Đang tạo mã…' : status.premium ? `Gia hạn ${status.days} ngày · ${vnd(status.price)}` : `Lên Premium · ${vnd(status.price)}`}
        </button>
      )}

      {error && <p role="alert" className="text-[13px] text-[var(--color-son)]">{error}</p>}

      <details className="text-[13px] text-[var(--color-muted)]">
        <summary className="cursor-pointer text-[var(--color-ink)]">Chuyển khoản rồi mà chưa thấy kích hoạt?</summary>
        <p className="mt-2 max-w-[60ch] leading-relaxed">
          Thường chỉ mất vài giây. Nếu quên ghi nội dung chuyển khoản hoặc chuyển thiếu, tiền vẫn được ghi lại và
          sẽ được kích hoạt thủ công. Gửi email cho Nhịp Bút kèm thời gian chuyển và mã đơn.
        </p>
      </details>
    </div>
  );
}

function Checkout({ initial, onPaid }: { initial: PremiumOrder; onPaid: () => Promise<void> }) {
  const [order, setOrder] = useState(initial);
  const [copied, setCopied] = useState<string | null>(null);
  const paidOnce = useRef(false);

  // Poll until paid. Keeps going after the QR "expires": a transfer made a
  // little late is still honoured, so the page should still notice it.
  useEffect(() => {
    if (order.status === 'PAID') return;
    const t = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        setOrder(await api.premiumOrder(order.code));
      } catch {
        /* the next tick tries again */
      }
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [order.code, order.status]);

  useEffect(() => {
    if (order.status === 'PAID' && !paidOnce.current) {
      paidOnce.current = true;
      void onPaid();
    }
  }, [order.status, onPaid]);

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked: the text is on screen to copy by hand */
    }
  }

  if (order.status === 'PAID') {
    return (
      <section className="card flex flex-col gap-2 p-6" aria-live="polite">
        <PremiumBadge size="md" />
        <h2 className="display text-2xl">Đã nhận tiền. Cảm ơn bạn!</h2>
        <p className="text-[14px] text-[var(--color-muted)]">
          Premium đã bật{order.premiumUntil ? `, đến hết ngày ${date(order.premiumUntil)}` : ''}.
        </p>
      </section>
    );
  }

  const short = order.amount - order.paidAmount;
  const rows: [string, string, boolean][] = [
    ['Ngân hàng', order.bank.code, false],
    ['Số tài khoản', order.bank.account, true],
    ['Chủ tài khoản', order.bank.name, false],
    ['Số tiền', vnd(short), false],
    ['Nội dung', order.code, true],
  ];

  return (
    <section className="card grid gap-6 p-5 sm:grid-cols-[220px_1fr] sm:p-6" aria-live="polite">
      <div className="flex flex-col items-center gap-2">
        {/* White behind the code in both themes: banking apps read dark-on-light. */}
        <div className="rounded-[var(--radius-md)] bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={order.qrUrl} alt={`Mã QR chuyển ${vnd(short)} với nội dung ${order.code}`} width={200} height={200} className="h-[200px] w-[200px]" />
        </div>
        <span className="text-[11.5px] text-[var(--color-faint)]">Quét bằng app ngân hàng bất kỳ</span>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {order.status === 'UNDERPAID' ? (
          <p className="text-[13.5px] text-[var(--color-son)]">
            Đã nhận {vnd(order.paidAmount)}, còn thiếu {vnd(short)}. Chuyển thêm phần còn lại với cùng nội dung.
          </p>
        ) : (
          <p className="text-[13.5px] text-[var(--color-muted)]">
            Giữ nguyên <strong className="text-[var(--color-ink)]">nội dung chuyển khoản</strong> để được kích hoạt
            tự động.
          </p>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13.5px]">
          {rows.map(([k, v, canCopy]) => (
            <div key={k} className="contents">
              <dt className="text-[var(--color-muted)]">{k}</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <span className={`truncate ${k === 'Nội dung' ? 'font-mono font-semibold tracking-wider text-[var(--color-accent)]' : ''}`}>{v}</span>
                {canCopy && (
                  <button
                    type="button"
                    onClick={() => copy(k, v)}
                    className="shrink-0 rounded border border-[var(--color-line)] px-1.5 py-px text-[11px] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
                  >
                    {copied === k ? 'Đã chép' : 'Chép'}
                  </button>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <p className="flex items-center gap-2 text-[12.5px] text-[var(--color-faint)]">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)] motion-reduce:animate-none" aria-hidden />
          Đang chờ tiền về. Trang tự cập nhật, không cần tải lại.
        </p>
      </div>
    </section>
  );
}
