import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { EntityService } from '../../shared/services/entity.service';
import { pageCount, pageWindow } from '../../shared/utils/portal-view.util';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';

export interface EventLogFilters {
  q?: string;
  status?: string;
  event?: string;
  webhook?: string;
}

/**
 * The webhook event log: every delivery attempt, newest first. Rows older
 * than a month are deleted every night at 03:00 (Nairobi) and on start, so a
 * missed night is caught up.
 */
@Injectable()
export class WebhookLogService
  extends EntityService<WebhookDelivery>
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(WebhookLogService.name);

  constructor(
    @InjectRepository(WebhookDelivery)
    private deliveryRepository: Repository<WebhookDelivery>,
  ) {
    super();
    super.setRepository(this.deliveryRepository);
  }

  private scoped(businessId: number) {
    return this.deliveryRepository
      .createQueryBuilder('delivery')
      .where('delivery."businessId" = :businessId', { businessId });
  }

  async search(businessId: number, filters: EventLogFilters, page = 1) {
    const builder = this.scoped(businessId).orderBy(
      'delivery.createdAt',
      'DESC',
    );
    const term = (filters.q ?? '').trim();
    if (term)
      builder.andWhere(
        new Brackets((where) =>
          where
            .where('delivery.eventId ILIKE :term', { term: `%${term}%` })
            .orWhere('delivery.url ILIKE :term', { term: `%${term}%` })
            .orWhere('delivery.payload ILIKE :term', { term: `%${term}%` }),
        ),
      );
    if (filters.status)
      builder.andWhere('delivery.status = :status', { status: filters.status });
    if (filters.event)
      builder.andWhere('delivery.event = :event', { event: filters.event });
    if (Number(filters.webhook))
      builder.andWhere('delivery."webhookId" = :webhook', {
        webhook: Number(filters.webhook),
      });
    const window = pageWindow(page);
    const [items, total] = await builder
      .skip(window.skip)
      .take(window.take)
      .getManyAndCount();
    return { items, total, page: window.page, pages: pageCount(total) };
  }

  async counts(businessId: number): Promise<Record<string, number>> {
    const rows = await this.scoped(businessId)
      .select('delivery.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('delivery.status')
      .getRawMany<{ status: string; count: string }>();
    const counts: Record<string, number> = { all: 0 };
    for (const row of rows) {
      counts[row.status] = Number(row.count);
      counts.all += Number(row.count);
    }
    return counts;
  }

  async findInBusiness(businessId: number, id: number) {
    return this.scoped(businessId)
      .andWhere('delivery.id = :id', { id })
      .getOne();
  }

  /** Deletes log rows older than one month; returns how many went. */
  @Cron('0 3 * * *', {
    name: 'webhook-log-cleanup',
    timeZone: 'Africa/Nairobi',
  })
  async cleanup(): Promise<number> {
    try {
      const result = await this.deliveryRepository
        .createQueryBuilder()
        .delete()
        .from(WebhookDelivery)
        .where(`"createdAt" < now() - interval '1 month'`)
        .execute();
      const removed = result.affected ?? 0;
      if (removed)
        this.logger.log(`Removed ${removed} webhook log(s) older than a month`);
      return removed;
    } catch (error) {
      this.logger.error(
        `Webhook log cleanup failed: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.cleanup();
  }
}
