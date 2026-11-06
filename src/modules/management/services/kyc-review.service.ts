import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotifyService } from '../../notifications/services/notify.service';
import {
  Business,
  OnboardingStatus,
} from '../../onboarding/entities/business.entity';
import {
  Kyc,
  KycItem,
  ReviewStatus,
} from '../../onboarding/entities/kyc.entity';
import {
  KycService,
  OnboardingStage,
} from '../../onboarding/services/kyc.service';
import { EmailTemplate } from '../../shared/constants/email-templates';
import { FormError } from '../../shared/utils/form.util';
import { MerchantAdminService } from './merchant-admin.service';

export interface ItemDecision {
  requirementId: number;
  status: ReviewStatus;
  comment?: string;
}

export type ReviewOutcome = 'save' | 'approve' | 'reject';

/**
 * The SaveApp team's review of a merchant's KYC: each item is accepted or
 * rejected with a comment, then the business is approved or sent back.
 * The merchant's team is emailed about the outcome.
 */
@Injectable()
export class KycReviewService {
  constructor(
    @InjectRepository(Kyc) private kycRepository: Repository<Kyc>,
    @InjectRepository(Business)
    private businessRepository: Repository<Business>,
    private readonly kycService: KycService,
    private readonly merchantAdmin: MerchantAdminService,
    private readonly notifyService: NotifyService,
  ) {}

  /** Applies per-item decisions; returns the updated list and rejections. */
  applyDecisions(items: KycItem[], decisions: ItemDecision[]) {
    const now = new Date().toISOString();
    const rejected: Array<{ name: string; comment: string }> = [];
    const next = items.map((item) => {
      const decision = decisions.find(
        (entry) => entry.requirementId === item.requirementId,
      );
      if (!decision || item.value === null) {
        if (item.status === ReviewStatus.Rejected)
          rejected.push({ name: item.name, comment: item.comment ?? '' });
        return item;
      }
      const comment =
        decision.status === ReviewStatus.Rejected
          ? decision.comment?.trim() ||
            'Please provide a clearer or correct document'
          : null;
      if (decision.status === ReviewStatus.Rejected)
        rejected.push({ name: item.name, comment: comment as string });
      const changed =
        decision.status !== item.status || comment !== (item.comment ?? null);
      return changed
        ? {
            ...item,
            status: decision.status,
            comment,
            reviewedAt: decision.status === ReviewStatus.Pending ? null : now,
          }
        : item;
    });
    return { items: next, rejected };
  }

  /**
   * Saves item decisions and, if asked, the outcome. Approving needs the
   * documents submitted, every required item provided and every provided
   * item (for a current requirement) accepted. Rejecting needs a rejected
   * item or a note; the merchant can then fix and resubmit.
   */
  async review(
    business: Business,
    kyc: Kyc,
    decisions: ItemDecision[],
    outcome: ReviewOutcome,
    note?: string,
  ): Promise<string> {
    const { items, rejected } = this.applyDecisions(kyc.kyc ?? [], decisions);
    const stage = this.kycService.stage(business, kyc);
    const requirements = await this.kycService.requirementsFor(business);
    const current = new Set(requirements.map((item) => item.id));
    const progress = this.kycService.progress(requirements, items);

    if (outcome !== 'save' && stage !== OnboardingStage.Review)
      throw new FormError(
        stage === OnboardingStage.Draft
          ? `${business.name} hasn't submitted its documents yet`
          : `${business.name} has already been reviewed`,
      );

    if (outcome === 'approve') {
      if (progress.missing)
        throw new FormError(
          `${progress.missing} required item${progress.missing === 1 ? ' is' : 's are'} still missing. Reject so the merchant can add ${progress.missing === 1 ? 'it' : 'them'}.`,
        );
      const blocking = items.filter(
        (item) =>
          item.value !== null &&
          current.has(item.requirementId) &&
          item.status !== ReviewStatus.Accepted,
      );
      if (blocking.length)
        throw new FormError(
          `Accept every item before approving (${blocking.map((item) => item.name).join(', ')})`,
        );
      await this.kycRepository.update(
        { id: kyc.id },
        { kyc: items, status: OnboardingStatus.Approved, reviewNote: null },
      );
      await this.businessRepository.update(
        { id: business.id },
        { status: OnboardingStatus.Approved },
      );
      await this.merchantAdmin.notifyStatus(
        business,
        'Approved',
        'Your business has been approved. Your team can now use the SaveApp merchant portal in full.',
      );
      return `${business.name} approved · team notified`;
    }

    if (outcome === 'reject') {
      if (!rejected.length && !note?.trim())
        throw new FormError(
          'Reject at least one item or add a note explaining what needs to change',
        );
      await this.kycRepository.update(
        { id: kyc.id },
        {
          kyc: items,
          status: OnboardingStatus.Rejected,
          reviewNote: note?.trim() || null,
        },
      );
      await this.businessRepository.update(
        { id: business.id },
        { status: OnboardingStatus.Rejected },
      );
      for (const user of await this.merchantAdmin.recipients(business.id))
        this.notifyService.email({
          email: user.email,
          subject: `${business.name}: some details need changes`,
          template: EmailTemplate.BusinessKycReview,
          context: {
            name: user.fullName,
            businessName: business.name,
            items: [
              ...rejected,
              ...(note?.trim()
                ? [{ name: 'Note from the SaveApp team', comment: note.trim() }]
                : []),
            ],
            url: this.notifyService.url('/merchant/settings/onboarding'),
          },
        });
      return `${business.name} sent back for changes · team notified`;
    }

    await this.kycRepository.update({ id: kyc.id }, { kyc: items });
    return 'Review saved';
  }
}
