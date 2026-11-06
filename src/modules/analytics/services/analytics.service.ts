import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** Days are counted in Kenya time, whatever the server's zone. */
const ZONE = 'Africa/Nairobi';
const DAY_MS = 24 * 60 * 60_000;

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

/** One business, or every business (admin) when businessId is null. */
export interface AnalyticsScope {
  businessId: number | null;
  days: RangeDays;
}

interface Window {
  from: Date;
  to: Date;
  days: string[];
}

export interface Totals {
  moneyIn: number;
  moneyOut: number;
  transactions: number;
  approved: number;
  cardsUsed: number;
  cardsIssued: number;
  deliveries: number;
  delivered: number;
  avgDeliveryMs: number | null;
}

const num = (value: unknown) => Number(value ?? 0) || 0;

/** YYYY-MM-DD of a moment, in Kenya time. */
const kenyaDay = (moment: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(moment);

/**
 * Figures for the Analytics page of both portals: card transactions (money
 * in and out, types, merchants), cards (issued, by status), webhook events
 * (deliveries, failures, response time) and, for the SaveApp team,
 * merchants. Everything is scoped to one business or to all of them, over
 * the last 7, 30 or 90 days, with the window before it for comparison.
 *
 * Column notes: card_transaction."occurredAt" is timestamptz; card."issuedAt"
 * holds Kenya wall time; "createdAt" columns default to now() in the
 * database's zone (UTC) without a zone.
 */
@Injectable()
export class AnalyticsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** The last `days` Kenya days up to now, and the same span before it. */
  window(days: RangeDays): { current: Window; previous: Window } {
    const today = kenyaDay(new Date());
    // Kenya is UTC+3 all year: Kenya midnight is 21:00 UTC the day before
    const startOfToday = new Date(`${today}T00:00:00+03:00`);
    const from = new Date(startOfToday.getTime() - (days - 1) * DAY_MS);
    const list = Array.from({ length: days }, (_, i) =>
      kenyaDay(new Date(from.getTime() + i * DAY_MS + 12 * 60 * 60_000)),
    );
    const previousFrom = new Date(from.getTime() - days * DAY_MS);
    return {
      current: { from, to: new Date(), days: list },
      previous: { from: previousFrom, to: from, days: [] },
    };
  }

  private run<T>(sql: string, params: unknown[]): Promise<T[]> {
    return this.dataSource.query<T[]>(sql, params);
  }

  /* --------------------------- Transactions -------------------------- */

  async totals(scope: AnalyticsScope, range: Window): Promise<Totals> {
    const params = [range.from, range.to, scope.businessId];
    const [tx] = await this.run<Record<string, string>>(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS "moneyIn",
         COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0) AS "moneyOut",
         COUNT(*) AS "transactions",
         COUNT(*) FILTER (WHERE status = 'Approved') AS "approved",
         COUNT(DISTINCT "cardId") AS "cardsUsed"
       FROM card_transaction
       WHERE "occurredAt" >= $1 AND "occurredAt" < $2
         AND ($3::int IS NULL OR "businessId" = $3)`,
      params,
    );
    const [cards] = await this.run<Record<string, string>>(
      `SELECT COUNT(*) AS "issued"
       FROM card c JOIN holder h ON h.id = c."holderId"
       WHERE (c."issuedAt" AT TIME ZONE '${ZONE}') >= $1
         AND (c."issuedAt" AT TIME ZONE '${ZONE}') < $2
         AND ($3::int IS NULL OR h."businessId" = $3)`,
      params,
    );
    const [events] = await this.run<Record<string, string>>(
      `SELECT COUNT(*) AS "deliveries",
         COUNT(*) FILTER (WHERE status = 'Delivered') AS "delivered",
         AVG("durationMs") AS "avgMs"
       FROM webhook_delivery
       WHERE ("createdAt" AT TIME ZONE 'UTC') >= $1
         AND ("createdAt" AT TIME ZONE 'UTC') < $2
         AND ($3::int IS NULL OR "businessId" = $3)`,
      params,
    );
    return {
      moneyIn: num(tx.moneyIn),
      moneyOut: num(tx.moneyOut),
      transactions: num(tx.transactions),
      approved: num(tx.approved),
      cardsUsed: num(tx.cardsUsed),
      cardsIssued: num(cards.issued),
      deliveries: num(events.deliveries),
      delivered: num(events.delivered),
      avgDeliveryMs:
        events.avgMs === null ? null : Math.round(Number(events.avgMs)),
    };
  }

  /** Per Kenya day: money in, money out and the number of transactions. */
  async transactionsDaily(scope: AnalyticsScope, range: Window) {
    const rows = await this.run<Record<string, string>>(
      `SELECT to_char(("occurredAt" AT TIME ZONE '${ZONE}')::date, 'YYYY-MM-DD') AS day,
         COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS "moneyIn",
         COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0) AS "moneyOut",
         COUNT(*) AS "count"
       FROM card_transaction
       WHERE "occurredAt" >= $1 AND "occurredAt" < $2
         AND ($3::int IS NULL OR "businessId" = $3)
       GROUP BY 1`,
      [range.from, range.to, scope.businessId],
    );
    const byDay = new Map(rows.map((row) => [row.day, row]));
    return range.days.map((day) => ({
      day,
      moneyIn: num(byDay.get(day)?.moneyIn),
      moneyOut: num(byDay.get(day)?.moneyOut),
      count: num(byDay.get(day)?.count),
    }));
  }

  /** What the transactions were (UnionPay's description), most common first. */
  async transactionTypes(scope: AnalyticsScope, range: Window) {
    const rows = await this.run<Record<string, string>>(
      `SELECT description AS label, COUNT(*) AS "count",
         COALESCE(SUM(ABS(amount)), 0) AS "amount"
       FROM card_transaction
       WHERE "occurredAt" >= $1 AND "occurredAt" < $2
         AND ($3::int IS NULL OR "businessId" = $3)
       GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8`,
      [range.from, range.to, scope.businessId],
    );
    return rows.map((row) => ({
      label: row.label || 'Transaction',
      count: num(row.count),
      amount: num(row.amount),
    }));
  }

  /** Where cards were used, by amount spent. */
  async topMerchants(scope: AnalyticsScope, range: Window) {
    const rows = await this.run<Record<string, string>>(
      `SELECT "merchantName" AS label, COUNT(*) AS "count",
         COALESCE(SUM(ABS(amount)), 0) AS "amount"
       FROM card_transaction
       WHERE "occurredAt" >= $1 AND "occurredAt" < $2
         AND ($3::int IS NULL OR "businessId" = $3)
         AND "merchantName" <> ''
       GROUP BY 1 ORDER BY 3 DESC, 2 DESC LIMIT 8`,
      [range.from, range.to, scope.businessId],
    );
    return rows.map((row) => ({
      label: row.label,
      count: num(row.count),
      amount: num(row.amount),
    }));
  }

  /* ------------------------------ Cards ------------------------------ */

  async cardsIssuedDaily(scope: AnalyticsScope, range: Window) {
    const rows = await this.run<Record<string, string>>(
      `SELECT to_char(c."issuedAt"::date, 'YYYY-MM-DD') AS day, COUNT(*) AS "count"
       FROM card c JOIN holder h ON h.id = c."holderId"
       WHERE (c."issuedAt" AT TIME ZONE '${ZONE}') >= $1
         AND (c."issuedAt" AT TIME ZONE '${ZONE}') < $2
         AND ($3::int IS NULL OR h."businessId" = $3)
       GROUP BY 1`,
      [range.from, range.to, scope.businessId],
    );
    const byDay = new Map(rows.map((row) => [row.day, num(row.count)]));
    return range.days.map((day) => ({ day, count: byDay.get(day) ?? 0 }));
  }

  /** Every card the scope ever issued, by its status today. */
  async cardsByStatus(scope: AnalyticsScope) {
    const rows = await this.run<Record<string, string>>(
      `SELECT c.status AS label, COUNT(*) AS "count"
       FROM card c JOIN holder h ON h.id = c."holderId"
       WHERE ($1::int IS NULL OR h."businessId" = $1)
       GROUP BY 1`,
      [scope.businessId],
    );
    const counts = new Map(rows.map((row) => [row.label, num(row.count)]));
    return ['Active', 'Blocked', 'Replaced', 'Terminated'].map((label) => ({
      label,
      count: counts.get(label) ?? 0,
    }));
  }

  /* ----------------------------- Webhooks ---------------------------- */

  async deliveriesDaily(scope: AnalyticsScope, range: Window) {
    const rows = await this.run<Record<string, string>>(
      `SELECT to_char((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE '${ZONE}')::date, 'YYYY-MM-DD') AS day,
         COUNT(*) FILTER (WHERE status = 'Delivered') AS "delivered",
         COUNT(*) FILTER (WHERE status <> 'Delivered') AS "failed"
       FROM webhook_delivery
       WHERE ("createdAt" AT TIME ZONE 'UTC') >= $1
         AND ("createdAt" AT TIME ZONE 'UTC') < $2
         AND ($3::int IS NULL OR "businessId" = $3)
       GROUP BY 1`,
      [range.from, range.to, scope.businessId],
    );
    const byDay = new Map(rows.map((row) => [row.day, row]));
    return range.days.map((day) => ({
      day,
      delivered: num(byDay.get(day)?.delivered),
      failed: num(byDay.get(day)?.failed),
    }));
  }

  async deliveriesByEvent(scope: AnalyticsScope, range: Window) {
    const rows = await this.run<Record<string, string>>(
      `SELECT event AS label, COUNT(*) AS "count",
         COUNT(*) FILTER (WHERE status <> 'Delivered') AS "failed",
         ROUND(AVG("durationMs")) AS "avgMs"
       FROM webhook_delivery
       WHERE ("createdAt" AT TIME ZONE 'UTC') >= $1
         AND ("createdAt" AT TIME ZONE 'UTC') < $2
         AND ($3::int IS NULL OR "businessId" = $3)
       GROUP BY 1 ORDER BY 2 DESC, 1`,
      [range.from, range.to, scope.businessId],
    );
    return rows.map((row) => ({
      label: row.label,
      count: num(row.count),
      failed: num(row.failed),
      avgMs: num(row.avgMs),
    }));
  }

  /* --------------------------- Merchants (admin) --------------------- */

  async merchantsByStatus() {
    const rows = await this.run<Record<string, string>>(
      `SELECT status AS label, COUNT(*) AS "count" FROM business GROUP BY 1`,
      [],
    );
    const counts = new Map(rows.map((row) => [row.label, num(row.count)]));
    return ['Approved', 'Pending', 'Rejected', 'Suspended'].map((label) => ({
      label,
      count: counts.get(label) ?? 0,
    }));
  }

  async merchantsJoinedDaily(range: Window) {
    const rows = await this.run<Record<string, string>>(
      `SELECT to_char((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE '${ZONE}')::date, 'YYYY-MM-DD') AS day,
         COUNT(*) AS "count"
       FROM business
       WHERE ("createdAt" AT TIME ZONE 'UTC') >= $1 AND ("createdAt" AT TIME ZONE 'UTC') < $2
       GROUP BY 1`,
      [range.from, range.to],
    );
    const byDay = new Map(rows.map((row) => [row.day, num(row.count)]));
    return range.days.map((day) => ({ day, count: byDay.get(day) ?? 0 }));
  }

  /** Merchants by card money moved in the window, with their card counts. */
  async topBusinesses(range: Window) {
    const rows = await this.run<Record<string, string>>(
      `SELECT b.id, b.name AS label,
         COALESCE(t.amount, 0) AS "amount", COALESCE(t.count, 0) AS "count",
         (SELECT COUNT(*) FROM card c JOIN holder h ON h.id = c."holderId"
           WHERE h."businessId" = b.id) AS "cards"
       FROM business b
       LEFT JOIN (
         SELECT "businessId", SUM(ABS(amount)) AS amount, COUNT(*) AS count
         FROM card_transaction
         WHERE "occurredAt" >= $1 AND "occurredAt" < $2
         GROUP BY 1
       ) t ON t."businessId" = b.id
       ORDER BY 3 DESC, 5 DESC, 2 LIMIT 8`,
      [range.from, range.to],
    );
    return rows.map((row) => ({
      label: row.label,
      amount: num(row.amount),
      count: num(row.count),
      cards: num(row.cards),
    }));
  }

  /* ----------------------------- Overview ---------------------------- */

  /** Latest card transactions, newest first (all merchants when null). */
  async recentTransactions(businessId: number | null, limit = 6) {
    const rows = await this.run<Record<string, string>>(
      `SELECT t."occurredAt" AS "occurredAt", t.description, t.amount, t.currency,
         t.status, t."merchantName", c.id AS "cardId", c.name AS "cardName",
         c."accountNumber", b.name AS "businessName"
       FROM card_transaction t
       JOIN card c ON c.id = t."cardId"
       JOIN business b ON b.id = t."businessId"
       WHERE ($1::int IS NULL OR t."businessId" = $1)
       ORDER BY t."occurredAt" DESC, t.id DESC LIMIT $2`,
      [businessId, limit],
    );
    return rows.map((row) => ({
      occurredAt: new Date(row.occurredAt),
      description: row.description || 'Transaction',
      amount: num(row.amount),
      currency: row.currency,
      status: row.status,
      merchantName: row.merchantName,
      cardId: Number(row.cardId),
      cardName: row.cardName,
      maskedNumber: row.accountNumber,
      businessName: row.businessName,
    }));
  }

  /** Cards of a business (or all) that are active today, and all of them. */
  async cardCounts(businessId: number | null) {
    const [row] = await this.run<Record<string, string>>(
      `SELECT COUNT(*) AS "total",
         COUNT(*) FILTER (WHERE c.status = 'Active') AS "active"
       FROM card c JOIN holder h ON h.id = c."holderId"
       WHERE ($1::int IS NULL OR h."businessId" = $1)`,
      [businessId],
    );
    return { total: num(row.total), active: num(row.active) };
  }

  /** API keys and webhook endpoints of a business, and how they're doing. */
  async integrationHealth(businessId: number) {
    const [keys] = await this.run<Record<string, string | null>>(
      `SELECT COUNT(*) FILTER (WHERE active) AS "active", COUNT(*) AS "total",
         MAX("lastUsedAt") AS "lastUsedAt"
       FROM credential WHERE "businessId" = $1`,
      [businessId],
    );
    const [hooks] = await this.run<Record<string, string | null>>(
      `SELECT COUNT(*) FILTER (WHERE active) AS "active", COUNT(*) AS "total"
       FROM webhook WHERE "businessId" = $1`,
      [businessId],
    );
    const [last] = await this.run<Record<string, string | null>>(
      `SELECT event, status, url, ("createdAt" AT TIME ZONE 'UTC') AS "at"
       FROM webhook_delivery WHERE "businessId" = $1
       ORDER BY id DESC LIMIT 1`,
      [businessId],
    );
    return {
      keys: {
        active: num(keys.active),
        total: num(keys.total),
        lastUsedAt: keys.lastUsedAt ? new Date(keys.lastUsedAt) : null,
      },
      webhooks: { active: num(hooks.active), total: num(hooks.total) },
      lastDelivery: last
        ? {
            event: last.event,
            delivered: last.status === 'Delivered',
            at: last.at ? new Date(last.at) : null,
          }
        : null,
    };
  }

  /** Newest businesses on SaveApp (admin). */
  async recentMerchants(limit = 5) {
    const rows = await this.run<Record<string, string>>(
      `SELECT b.id, b.name, b.email, b.status, b.logo,
         (b."createdAt" AT TIME ZONE 'UTC') AS "createdAt",
         (SELECT COUNT(*) FROM card c JOIN holder h ON h.id = c."holderId"
           WHERE h."businessId" = b.id) AS "cards"
       FROM business b ORDER BY b.id DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      email: row.email,
      status: row.status,
      createdAt: new Date(row.createdAt),
      cards: num(row.cards),
    }));
  }

  async businesses() {
    return this.run<{ id: number; name: string }>(
      `SELECT id, name FROM business ORDER BY name`,
      [],
    );
  }
}
