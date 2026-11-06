import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuthorizationLevel } from '../../authorization/entities/permission.entity';
import { EntityService } from '../../shared/services/entity.service';
import { Account } from '../entities/account.entity';
import { OnboardingStatus } from '../entities/business.entity';

export interface AccountSummary {
  id: number;
  level: AuthorizationLevel;
  name: string;
  description: string;
}

/** Levels that open a web portal; B2C customers are served by the app later. */
export const PORTAL_LEVELS = [
  AuthorizationLevel.Staff,
  AuthorizationLevel.B2B,
  AuthorizationLevel.WhiteLabel,
];

/** Label and pill tone for a business status. */
export const businessStatusMeta = (status: OnboardingStatus) =>
  ({
    [OnboardingStatus.Approved]: { statusLabel: 'Approved', tone: 'success' },
    [OnboardingStatus.Pending]: { statusLabel: 'Pending', tone: 'warning' },
    [OnboardingStatus.Rejected]: { statusLabel: 'Rejected', tone: 'danger' },
    [OnboardingStatus.Suspended]: {
      statusLabel: 'Suspended',
      tone: 'neutral',
    },
  })[status] ?? { statusLabel: status, tone: 'neutral' };

@Injectable()
export class AccountService extends EntityService<Account> {
  constructor(
    @InjectRepository(Account) private accountRepository: Repository<Account>,
  ) {
    super();
    super.setRepository(this.accountRepository);
  }

  /** Active accounts that open a portal (staff and merchants), newest first. */
  async portalAccounts(userId: number): Promise<Account[]> {
    return this.filterMany(
      { user: { id: userId }, active: true, type: In(PORTAL_LEVELS) },
      { relations: { business: true }, order: { createdAt: 'DESC' } },
    );
  }

  async activeAccount(
    userId: number,
    accountId: number,
  ): Promise<Account | null> {
    return this.filter(
      { id: accountId, user: { id: userId }, active: true },
      { relations: { business: { country: true } } },
    );
  }

  summarize(account: Account): AccountSummary {
    switch (account.type) {
      case AuthorizationLevel.Staff:
        return {
          id: account.id,
          level: account.type,
          name: 'SaveApp',
          description: 'SaveApp team',
        };
      case AuthorizationLevel.WhiteLabel:
        return {
          id: account.id,
          level: account.type,
          name: account.business?.name ?? 'Business',
          description: 'White-label merchant',
        };
      case AuthorizationLevel.B2B:
        return {
          id: account.id,
          level: account.type,
          name: account.business?.name ?? 'Business',
          description: 'Merchant',
        };
      default:
        return {
          id: account.id,
          level: account.type,
          name: 'Personal account',
          description: 'Customer',
        };
    }
  }
}
