import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { User } from '../../authentication/entities/user.entity';
import { NotifyService } from '../../notifications/services/notify.service';
import { Account } from '../../onboarding/entities/account.entity';
import {
  Business,
  OnboardingStatus,
} from '../../onboarding/entities/business.entity';
import { Kyc } from '../../onboarding/entities/kyc.entity';
import { EmailTemplate } from '../../shared/constants/email-templates';
import { EntityService } from '../../shared/services/entity.service';
import { FormError } from '../../shared/utils/form.util';
import { pageCount, pageWindow } from '../../shared/utils/portal-view.util';

/** Merchant list filters: business status, with Pending split by submission. */
export enum MerchantFilter {
  Review = 'review',
  Onboarding = 'onboarding',
  Approved = 'Approved',
  Rejected = 'Rejected',
  Suspended = 'Suspended',
}

export const STATUS_ACTIONS: Record<
  string,
  {
    from: OnboardingStatus;
    to: OnboardingStatus;
    label: string;
    message: string;
  }
> = {
  suspend: {
    from: OnboardingStatus.Approved,
    to: OnboardingStatus.Suspended,
    label: 'Suspend',
    message:
      'Your business has been suspended on SaveApp. Contact support to resolve this.',
  },
  reactivate: {
    from: OnboardingStatus.Suspended,
    to: OnboardingStatus.Approved,
    label: 'Reactivate',
    message:
      'Your business has been reactivated. Your team can use SaveApp again.',
  },
};

export type MerchantRow = Business & { kycRecord?: Kyc };

/**
 * The admin side of merchants: the searchable list, status counts, the
 * people to notify and suspension. KYC decisions live in KycReviewService.
 */
@Injectable()
export class MerchantAdminService extends EntityService<Business> {
  constructor(
    @InjectRepository(Business)
    private businessRepository: Repository<Business>,
    @InjectRepository(Account) private accountRepository: Repository<Account>,
    private readonly notifyService: NotifyService,
  ) {
    super();
    super.setRepository(this.businessRepository);
  }

  private listQuery() {
    return this.businessRepository
      .createQueryBuilder('business')
      .leftJoinAndSelect('business.country', 'country')
      .leftJoinAndMapOne(
        'business.kycRecord',
        Kyc,
        'kyc',
        'kyc."businessId" = business.id',
      );
  }

  private applyFilter(
    builder: ReturnType<MerchantAdminService['listQuery']>,
    value: string,
  ) {
    const filter = value as MerchantFilter;
    if (filter === MerchantFilter.Review)
      builder.andWhere(
        'business.status = :pending AND kyc."submittedAt" IS NOT NULL',
        { pending: OnboardingStatus.Pending },
      );
    else if (filter === MerchantFilter.Onboarding)
      builder.andWhere(
        'business.status = :pending AND kyc."submittedAt" IS NULL',
        { pending: OnboardingStatus.Pending },
      );
    else if ((Object.values(OnboardingStatus) as string[]).includes(value))
      builder.andWhere('business.status = :status', { status: value });
  }

  async search(query = '', filter = '', page = 1) {
    const builder = this.listQuery().orderBy('business.createdAt', 'DESC');
    const term = query.trim();
    if (term)
      builder.andWhere(
        new Brackets((where) =>
          where
            .where('business.name ILIKE :term', { term: `%${term}%` })
            .orWhere('business.email ILIKE :term', { term: `%${term}%` })
            .orWhere('business.phone ILIKE :term', { term: `%${term}%` }),
        ),
      );
    this.applyFilter(builder, filter);
    const window = pageWindow(page);
    const [items, total] = await builder
      .skip(window.skip)
      .take(window.take)
      .getManyAndCount();
    return {
      items: items as MerchantRow[],
      total,
      page: window.page,
      pages: pageCount(total),
    };
  }

  /** Businesses per list filter, plus the total. */
  async counts(): Promise<Record<string, number>> {
    const rows = await this.listQuery()
      .select('business.status', 'status')
      .addSelect('(kyc."submittedAt" IS NOT NULL)', 'submitted')
      .addSelect('COUNT(*)', 'count')
      .groupBy('business.status')
      .addGroupBy('submitted')
      .getRawMany<{
        status: OnboardingStatus;
        submitted: boolean;
        count: string;
      }>();
    const counts: Record<string, number> = { all: 0 };
    for (const row of rows) {
      const key =
        row.status === OnboardingStatus.Pending
          ? row.submitted
            ? MerchantFilter.Review
            : MerchantFilter.Onboarding
          : row.status;
      counts[key] = (counts[key] ?? 0) + Number(row.count);
      counts.all += Number(row.count);
    }
    return counts;
  }

  /** Businesses waiting for a decision, oldest submission first. */
  async awaitingReview(limit = 5): Promise<MerchantRow[]> {
    // One KYC row per business, so a plain LIMIT is safe here
    const builder = this.listQuery()
      .orderBy('kyc."submittedAt"', 'ASC')
      .limit(limit);
    this.applyFilter(builder, MerchantFilter.Review);
    return await builder.getMany();
  }

  async find(id: number): Promise<Business | null> {
    return this.filter({ id }, { relations: { country: true } });
  }

  /** Everyone with an account in the business, newest first. */
  async members(businessId: number): Promise<Account[]> {
    return this.accountRepository.find({
      where: { business: { id: businessId } },
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });
  }

  /** Active role names per account of a business (workspace Team page). */
  async memberRoles(businessId: number): Promise<Map<number, string[]>> {
    const rows = await this.accountRepository.manager.query<
      { accountId: number; name: string }[]
    >(
      `SELECT ar."accountId", r.name
       FROM account_role ar
       JOIN role r ON r.id = ar."roleId"
       JOIN account a ON a.id = ar."accountId"
       WHERE a."businessId" = $1 AND ar.active
       ORDER BY r.name`,
      [businessId],
    );
    const roles = new Map<number, string[]>();
    for (const row of rows)
      roles.set(row.accountId, [...(roles.get(row.accountId) ?? []), row.name]);
    return roles;
  }

  /** Invitations of a business, newest first (workspace Team page). */
  async invites(businessId: number) {
    return this.accountRepository.manager.query<
      { email: string; status: string; createdAt: Date }[]
    >(
      `SELECT email, status, ("createdAt" AT TIME ZONE 'UTC') AS "createdAt"
       FROM invite WHERE "businessId" = $1 ORDER BY id DESC LIMIT 20`,
      [businessId],
    );
  }

  /** Active members who want emails about the business. */
  async recipients(businessId: number): Promise<User[]> {
    const accounts = await this.accountRepository.find({
      where: {
        business: { id: businessId },
        active: true,
        allowEmailNotifications: true,
      },
      relations: { user: true },
    });
    return accounts
      .map((account) => account.user)
      .filter((user) => user?.active);
  }

  /** Emails the business's team that its status changed. */
  async notifyStatus(business: Business, status: string, message: string) {
    for (const user of await this.recipients(business.id))
      this.notifyService.email({
        email: user.email,
        subject: `${business.name} is now ${status.toLowerCase()} on SaveApp`,
        template: EmailTemplate.BusinessStatus,
        context: {
          name: user.fullName,
          businessName: business.name,
          status,
          message,
          url: this.notifyService.url('/auth/login'),
        },
      });
  }

  async changeStatus(
    business: Business,
    action: string,
    note?: string,
  ): Promise<OnboardingStatus> {
    const transition = STATUS_ACTIONS[action];
    if (!transition) throw new FormError('Unknown action');
    if (business.status !== transition.from)
      throw new FormError(
        `${business.name} is ${business.status.toLowerCase()}, so it can't be ${transition.label.toLowerCase()}d`,
      );
    await this.update({ id: business.id }, { status: transition.to });
    await this.notifyStatus(
      business,
      transition.to,
      note?.trim()
        ? `${transition.message} Note from the SaveApp team: ${note.trim()}`
        : transition.message,
    );
    return transition.to;
  }
}
