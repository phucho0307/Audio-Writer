import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PremiumOrderStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user.service';
import { emailUnverified, requiresVerifiedEmail } from '../auth/verified';
import { isPremium, newOrderCode, orderCodeCandidates } from './premium';

/** How long the QR is shown as payable. A later transfer still counts. */
const ORDER_TTL_MS = 30 * 60_000;

/** What SePay posts for every transaction on the linked account. */
export interface SepayTransfer {
  id: number | string;
  transferType?: string;
  transferAmount?: number;
  content?: string | null;
  description?: string | null;
  code?: string | null;
  referenceCode?: string | null;
}

/**
 * Premium, paid by bank transfer.
 *
 * The reader gets a VietQR for the price with an order code in the
 * description; SePay watches the bank account and posts each incoming
 * transfer here. No payment gateway and no business registration: the money
 * goes straight into the owner's personal account, and the only thing this
 * code has to get right is matching a transfer to an order exactly once.
 *
 * - The same transfer delivered twice is stored once (unique SePay id), and
 *   the order is updated in the same transaction as that insert, so a retry
 *   can never grant twice.
 * - Two transfers for one order (someone paid in two parts) are summed under
 *   a row lock, so neither is lost.
 * - Short payments are recorded and not granted; transfers with no
 *   recognisable code are recorded for the admin page. Nothing is dropped.
 */
@Injectable()
export class PremiumService {
  private readonly logger = new Logger(PremiumService.name);
  readonly price: number;
  readonly days: number;
  private readonly bank: { code: string; account: string; name: string };
  private readonly needVerified: boolean;
  /** Free and premium allowances, for the page that sells the difference. */
  private readonly perks: Record<string, number>;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {
    this.price = Number(config.get('PREMIUM_PRICE', 15000));
    this.days = Number(config.get('PREMIUM_DAYS', 30));
    this.bank = {
      code: config.get<string>('BANK_CODE', ''),
      account: config.get<string>('BANK_ACCOUNT_NO', ''),
      name: config.get<string>('BANK_ACCOUNT_NAME', ''),
    };
    this.needVerified = requiresVerifiedEmail(config);
    // Read from the same settings the quota and search services use, so the
    // page can never promise a number the server does not give.
    this.perks = {
      aiFree: Number(config.get('AI_FREE_DAILY', 3)),
      aiPremium: Number(config.get('AI_PREMIUM_DAILY', 30)),
      searchFree: Number(config.get('DISCOVERY_DAILY', 20)),
      searchPremium: Number(config.get('DISCOVERY_PREMIUM_DAILY', 200)),
    };
  }

  /** Selling is on once there is an account to be paid into. */
  get enabled(): boolean {
    return Boolean(this.bank.code && this.bank.account);
  }

  async status() {
    const user = await this.currentUser.optional();
    return {
      enabled: this.enabled,
      price: this.price,
      days: this.days,
      perks: this.perks,
      premium: isPremium(user),
      premiumUntil: user?.premiumUntil ?? null,
    };
  }

  /**
   * An order to pay. Asking again within the QR's lifetime returns the same
   * one, so a reader who reloads the page does not end up with two codes and
   * pay the wrong one.
   */
  async createOrder() {
    if (!this.enabled) throw new ServiceUnavailableException('Premium chưa mở bán.');
    const user = await this.currentUser.current();
    // The receipt and any problem with the payment go to this address.
    if (this.needVerified && !user.emailVerifiedAt) throw emailUnverified();

    const recent = await this.prisma.premiumOrder.findFirst({
      where: {
        userId: user.id,
        status: PremiumOrderStatus.PENDING,
        amount: this.price,
        createdAt: { gt: new Date(Date.now() - ORDER_TTL_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) return this.present(recent);

    for (let attempt = 0; ; attempt++) {
      try {
        const order = await this.prisma.premiumOrder.create({
          data: { code: newOrderCode(randomBytes), userId: user.id, amount: this.price, days: this.days },
        });
        return this.present(order);
      } catch (e) {
        // A code collision; vanishingly rare, so retrying is enough.
        if (attempt < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
  }

  /** The QR page polls this until the transfer lands. */
  async order(code: string) {
    const user = await this.currentUser.current();
    const order = await this.prisma.premiumOrder.findUnique({ where: { code } });
    if (!order || order.userId !== user.id) throw new NotFoundException();
    return this.present(order, user.premiumUntil);
  }

  private present(
    o: { code: string; amount: number; days: number; status: PremiumOrderStatus; paidAmount: number; createdAt: Date },
    premiumUntil?: Date | null,
  ) {
    const qr = new URL('https://qr.sepay.vn/img');
    qr.search = new URLSearchParams({
      acc: this.bank.account,
      bank: this.bank.code,
      // After a short payment the QR asks for the rest, not the full price.
      amount: String(Math.max(0, o.amount - o.paidAmount) || o.amount),
      des: o.code,
      template: 'compact',
    }).toString();
    return {
      code: o.code,
      amount: o.amount,
      days: o.days,
      status: o.status,
      paidAmount: o.paidAmount,
      expiresAt: new Date(o.createdAt.getTime() + ORDER_TTL_MS),
      qrUrl: qr.toString(),
      bank: { code: this.bank.code, account: this.bank.account, name: this.bank.name },
      premiumUntil: premiumUntil ?? null,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * One transaction reported by SePay. The caller has already checked that
   * SePay sent it.
   */
  async receive(t: SepayTransfer): Promise<'ignored' | 'duplicate' | 'unmatched' | PremiumOrderStatus> {
    if (t.transferType !== 'in') return 'ignored';
    const amount = Math.round(Number(t.transferAmount ?? 0));
    if (!t.id || !(amount > 0)) return 'ignored';
    const content = (t.content ?? t.description ?? '').slice(0, 500);

    const codes = orderCodeCandidates(t.code, t.content, t.description);
    const order = codes.length
      ? await this.prisma.premiumOrder.findFirst({ where: { code: { in: codes } } })
      : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // First: the insert that makes a redelivery a no-op. If this row
        // already exists the whole transaction is rolled back below.
        await tx.bankTransfer.create({
          data: {
            sepayId: String(t.id),
            amount,
            content,
            reference: t.referenceCode ?? null,
            orderId: order?.id ?? null,
          },
        });
        if (!order) return 'unmatched' as const;

        // Lock the order so two parts of a split payment are summed in turn.
        const [locked] = await tx.$queryRaw<{ status: PremiumOrderStatus; paidAmount: number }[]>`
          SELECT "status", "paidAmount" FROM "premium_orders" WHERE "id" = ${order.id}::uuid FOR UPDATE`;
        const paid = locked.paidAmount + amount;

        // Already granted: an extra transfer is kept on record for the admin,
        // not turned into a second month nobody ordered.
        if (locked.status === PremiumOrderStatus.PAID) {
          await tx.premiumOrder.update({ where: { id: order.id }, data: { paidAmount: paid } });
          return PremiumOrderStatus.PAID;
        }
        if (paid < order.amount) {
          await tx.premiumOrder.update({
            where: { id: order.id },
            data: { paidAmount: paid, status: PremiumOrderStatus.UNDERPAID },
          });
          return PremiumOrderStatus.UNDERPAID;
        }
        await tx.premiumOrder.update({
          where: { id: order.id },
          data: { paidAmount: paid, status: PremiumOrderStatus.PAID, paidAt: new Date() },
        });
        await this.extend(tx, order.userId, order.days);
        return PremiumOrderStatus.PAID;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'duplicate';
      throw e;
    } finally {
      this.logger.log(`transfer ${t.id}: ${amount}đ, ${order ? `order ${order.code}` : 'no order code'}`);
    }
  }

  /** From the later of now and the current end, in one statement. */
  private extend(tx: Prisma.TransactionClient, userId: string, days: number) {
    return tx.$executeRaw`
      UPDATE "users"
      SET "premiumUntil" = GREATEST(COALESCE("premiumUntil", NOW()), NOW()) + make_interval(days => ${days}::int)
      WHERE "id" = ${userId}::uuid`;
  }

  // ---- admin ---------------------------------------------------------------

  private async admin() {
    const me = await this.currentUser.current();
    if (me.role !== Role.ADMIN) throw new NotFoundException();
  }

  async adminList() {
    await this.admin();
    const [orders, unmatched] = await Promise.all([
      this.prisma.premiumOrder.findMany({
        where: { status: { in: [PremiumOrderStatus.PAID, PremiumOrderStatus.UNDERPAID] } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { user: { select: { handle: true, displayName: true, premiumUntil: true } } },
      }),
      this.prisma.bankTransfer.findMany({
        where: { orderId: null },
        orderBy: { receivedAt: 'desc' },
        take: 30,
      }),
    ]);
    const paidOrders = await this.prisma.premiumOrder.aggregate({
      where: { status: PremiumOrderStatus.PAID },
      _sum: { paidAmount: true },
      _count: true,
    });
    const active = await this.prisma.user.count({ where: { premiumUntil: { gt: new Date() } } });
    return {
      active,
      paidCount: paidOrders._count,
      revenue: paidOrders._sum.paidAmount ?? 0,
      orders: orders.map((o) => ({
        code: o.code,
        status: o.status,
        amount: o.amount,
        paidAmount: o.paidAmount,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        user: o.user,
      })),
      unmatched: unmatched.map((t) => ({
        id: t.id,
        amount: t.amount,
        content: t.content,
        receivedAt: t.receivedAt,
      })),
    };
  }

  /**
   * Settles an order by hand: a short payment the owner has accepted, or a
   * transfer whose description lost the code. Grants once; a second click
   * is refused rather than adding another month.
   */
  async adminActivate(code: string, transferId?: string) {
    await this.admin();
    return this.prisma.$transaction(async (tx) => {
      const [o] = await tx.$queryRaw<{ id: string; userId: string; days: number; status: PremiumOrderStatus }[]>`
        SELECT "id", "userId", "days", "status" FROM "premium_orders" WHERE "code" = ${code} FOR UPDATE`;
      if (!o) throw new NotFoundException('Không có đơn với mã này.');
      if (o.status === PremiumOrderStatus.PAID) throw new BadRequestException('Đơn này đã kích hoạt rồi.');
      if (transferId) {
        const t = await tx.bankTransfer.findUnique({ where: { id: transferId } });
        if (!t || t.orderId) throw new BadRequestException('Giao dịch không tồn tại hoặc đã gắn với đơn khác.');
        await tx.bankTransfer.update({ where: { id: transferId }, data: { orderId: o.id } });
        await tx.premiumOrder.update({ where: { id: o.id }, data: { paidAmount: { increment: t.amount } } });
      }
      await tx.premiumOrder.update({
        where: { id: o.id },
        data: { status: PremiumOrderStatus.PAID, paidAt: new Date() },
      });
      await this.extend(tx, o.userId, o.days);
      return { ok: true };
    });
  }
}
