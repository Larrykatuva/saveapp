import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EntityService } from '../../shared/services/entity.service';
import { FormError } from '../../shared/utils/form.util';
import { formatDate } from '../../shared/utils/portal-view.util';
import { Business, OnboardingStatus } from '../entities/business.entity';
import { Kyc, KycItem, ReviewStatus } from '../entities/kyc.entity';
import { Requirement, RequirementInput } from '../entities/requirement.entity';
import {
  KYC_FILE_TYPES,
  KYC_MAX_FILE_BYTES,
  KycStorageService,
} from './kyc-storage.service';
import { RequirementService } from './requirement.service';

/** Where a business is in onboarding. */
export enum OnboardingStage {
  Draft = 'draft',
  Review = 'review',
  Rejected = 'rejected',
  Approved = 'approved',
  Suspended = 'suspended',
}

export interface KycProgress {
  required: number;
  provided: number;
  accepted: number;
  pending: number;
  rejected: number;
  missing: number;
  complete: boolean;
  percent: number;
}

const formatSize = (bytes?: number) =>
  !bytes
    ? ''
    : bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const STEPS = [
  { title: 'Create your account', text: 'Sign up and verify your email' },
  { title: 'Business details', text: 'Name, contacts, country and logo' },
  { title: 'Onboarding documents', text: 'Upload what your country needs' },
  { title: 'Review and approval', text: 'The SaveApp team checks everything' },
];

/**
 * A business's KYC: the requirements for its country and level, the answers
 * the merchant gives (kept on Kyc.kyc as snapshots) and the submission for
 * review. The admin side decides on each item in KycReviewService.
 */
@Injectable()
export class KycService extends EntityService<Kyc> {
  constructor(
    @InjectRepository(Kyc) private kycRepository: Repository<Kyc>,
    @InjectRepository(Business)
    private businessRepository: Repository<Business>,
    private readonly requirementService: RequirementService,
    private readonly kycStorage: KycStorageService,
  ) {
    super();
    super.setRepository(this.kycRepository);
  }

  /** The business's KYC record, created on first use. */
  async forBusiness(business: Business): Promise<Kyc> {
    const existing = await this.filter({ business: { id: business.id } });
    if (existing) return existing;
    return this.save({
      business,
      country: business.country,
      status: OnboardingStatus.Pending,
      kyc: [],
    });
  }

  requirementsFor(business: Business): Promise<Requirement[]> {
    return this.requirementService.forBusiness(
      business.country?.id,
      business.type,
    );
  }

  stage(business: Business, kyc: Kyc): OnboardingStage {
    switch (business.status) {
      case OnboardingStatus.Approved:
        return OnboardingStage.Approved;
      case OnboardingStatus.Suspended:
        return OnboardingStage.Suspended;
      case OnboardingStatus.Rejected:
        return OnboardingStage.Rejected;
      default:
        return kyc.submittedAt ? OnboardingStage.Review : OnboardingStage.Draft;
    }
  }

  /** The merchant can change answers while drafting or after a rejection. */
  editable(stage: OnboardingStage): boolean {
    return (
      stage === OnboardingStage.Draft || stage === OnboardingStage.Rejected
    );
  }

  progress(requirements: Requirement[], items: KycItem[]): KycProgress {
    const required = requirements.filter((item) => item.required);
    const state = (id: number) =>
      items.find((item) => item.requirementId === id && item.value !== null)
        ?.status;
    const count = (status: ReviewStatus) =>
      required.filter((item) => state(item.id) === status).length;
    const accepted = count(ReviewStatus.Accepted);
    const pending = count(ReviewStatus.Pending);
    const rejected = count(ReviewStatus.Rejected);
    const provided = accepted + pending + rejected;
    return {
      required: required.length,
      provided,
      accepted,
      pending,
      rejected,
      missing: required.length - provided,
      complete: accepted === required.length,
      percent: required.length
        ? Math.round((provided / required.length) * 100)
        : 100,
    };
  }

  /** Stepper for the onboarding layout and the merchant dashboard. */
  steps(stage: OnboardingStage | null) {
    const current =
      stage === null
        ? 1
        : stage === OnboardingStage.Draft || stage === OnboardingStage.Rejected
          ? 2
          : stage === OnboardingStage.Review
            ? 3
            : 4;
    return STEPS.map((step, index) => ({
      ...step,
      number: index + 1,
      done: index < current,
      current: index === current,
      failed: index === 2 && stage === OnboardingStage.Rejected,
    }));
  }

  /** Requirements with the merchant's answer to each, for tables. */
  rows(requirements: Requirement[], kyc: Kyc) {
    return requirements.map((requirement) => {
      const item = (kyc.kyc ?? []).find(
        (entry) =>
          entry.requirementId === requirement.id && entry.value !== null,
      );
      return {
        requirementId: requirement.id,
        name: requirement.name,
        help: requirement.comment,
        required: requirement.required,
        inputLabel:
          requirement.input === RequirementInput.FILE
            ? 'Document'
            : requirement.input === RequirementInput.NUMBER
              ? 'Number'
              : 'Text',
        submission: item ? this.itemView(item) : null,
      };
    });
  }

  itemView(item: KycItem) {
    const isFile = item.input === RequirementInput.FILE;
    return {
      requirementId: item.requirementId,
      name: item.name,
      isFile,
      value: isFile ? null : item.value,
      url: isFile ? item.value : null,
      isImage: Boolean(item.mimeType?.startsWith('image/')),
      fileName: item.fileName,
      size: formatSize(item.size),
      status: item.status,
      comment: item.comment,
      submitted: formatDate(item.submittedAt),
      isPending: item.status === ReviewStatus.Pending,
      isAccepted: item.status === ReviewStatus.Accepted,
      isRejected: item.status === ReviewStatus.Rejected,
    };
  }

  /** Stores a document or value for one requirement; it waits for review. */
  async submitItem(
    kyc: Kyc,
    requirement: Requirement,
    value: string | undefined,
    file: Express.Multer.File | undefined,
  ): Promise<void> {
    const item: KycItem = {
      requirementId: requirement.id,
      name: requirement.name,
      input: requirement.input,
      value: null,
      status: ReviewStatus.Pending,
      comment: null,
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
    };
    if (requirement.input === RequirementInput.FILE) {
      if (!file)
        throw new FormError('Please fix the highlighted fields', {
          value: 'Choose a file to upload',
        });
      if (!KYC_FILE_TYPES[file.mimetype])
        throw new FormError('Please fix the highlighted fields', {
          value: 'Upload a JPG, PNG, WEBP or PDF file',
        });
      if (file.size > KYC_MAX_FILE_BYTES)
        throw new FormError('Please fix the highlighted fields', {
          value: 'Files must be 5 MB or smaller',
        });
      item.value = await this.kycStorage.save(file);
      item.fileName = file.originalname;
      item.mimeType = file.mimetype;
      item.size = file.size;
    } else {
      const text = (value ?? '').trim();
      if (!text)
        throw new FormError('Please fix the highlighted fields', {
          value: `Enter the ${requirement.name.toLowerCase()}`,
        });
      if (
        requirement.input === RequirementInput.NUMBER &&
        !/^-?\d+(\.\d+)?$/.test(text)
      )
        throw new FormError('Please fix the highlighted fields', {
          value: 'Enter a number',
        });
      item.value = text.slice(0, 500);
    }
    const others = (kyc.kyc ?? []).filter(
      (entry) => entry.requirementId !== requirement.id,
    );
    await this.update({ id: kyc.id }, { kyc: [...others, item] });
  }

  /**
   * Sends the documents for review. Every required item must be provided
   * and, after a rejection, every rejected item replaced. A rejected business
   * goes back to Pending.
   */
  async submit(business: Business, kyc: Kyc): Promise<void> {
    const stage = this.stage(business, kyc);
    if (!this.editable(stage))
      throw new FormError(
        stage === OnboardingStage.Review
          ? 'Your documents are already with the SaveApp team'
          : 'Your business has already been reviewed',
      );
    const requirements = await this.requirementsFor(business);
    const progress = this.progress(requirements, kyc.kyc ?? []);
    if (progress.missing)
      throw new FormError(
        `Add the ${progress.missing} required item${progress.missing === 1 ? '' : 's'} still missing before you submit`,
      );
    if (progress.rejected)
      throw new FormError(
        'Replace the items that need changes before you submit again',
      );
    await this.update(
      { id: kyc.id },
      {
        submittedAt: new Date(),
        status: OnboardingStatus.Pending,
        reviewNote: null,
      },
    );
    if (business.status === OnboardingStatus.Rejected)
      await this.businessRepository.update(
        { id: business.id },
        { status: OnboardingStatus.Pending },
      );
  }
}
