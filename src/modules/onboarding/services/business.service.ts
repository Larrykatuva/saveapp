import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../authentication/entities/user.entity';
import { SystemRoles } from '../../authorization/constants/roles.catalog';
import { AuthorizationLevel } from '../../authorization/entities/permission.entity';
import { RoleService } from '../../authorization/services/role.service';
import { Country } from '../../settings/entities/country.entity';
import { EntityService } from '../../shared/services/entity.service';
import { StorageService } from '../../shared/services/storage.service';
import { FormError } from '../../shared/utils/form.util';
import { BusinessForm, CreateBusinessForm } from '../dtos/business-form.dto';
import { Account } from '../entities/account.entity';
import { Business, OnboardingStatus } from '../entities/business.entity';
import { Kyc } from '../entities/kyc.entity';

@Injectable()
export class BusinessService extends EntityService<Business> {
  constructor(
    @InjectRepository(Business)
    private businessRepository: Repository<Business>,
    @InjectRepository(Account) private accountRepository: Repository<Account>,
    @InjectRepository(Kyc) private kycRepository: Repository<Kyc>,
    @InjectRepository(Country) private countryRepository: Repository<Country>,
    private readonly roleService: RoleService,
    private readonly storageService: StorageService,
  ) {
    super();
    super.setRepository(this.businessRepository);
  }

  /**
   * Creates a business for the signed-in user: the business (Pending), their
   * B2B account with the Owner role, and an empty KYC record for the
   * business's country. Returns the new account.
   */
  async register(
    user: User,
    form: CreateBusinessForm,
    logo?: Express.Multer.File,
  ): Promise<Account> {
    const country = await this.countryRepository.findOneBy({
      id: form.country,
      active: true,
    });
    if (!country)
      throw new FormError('Please fix the highlighted fields', {
        country: 'Choose a country from the list',
      });
    const logoKey = logo ? await this.upload(logo) : null;

    const business = await this.save({
      name: form.name,
      email: form.email,
      phone: form.phone,
      address: form.address,
      country,
      type: AuthorizationLevel.B2B,
      status: OnboardingStatus.Pending,
      logo: logoKey,
    });
    await this.kycRepository.save({
      business,
      country,
      status: OnboardingStatus.Pending,
      kyc: [],
    });
    const account = await this.accountRepository.save({
      user,
      type: business.type,
      business,
      active: true,
    });
    await this.roleService.assignSystemRole(account, SystemRoles.Owner);
    return account;
  }

  /** Saves the business profile; the country stays as registered. */
  async updateProfile(
    business: Business,
    form: BusinessForm,
    logo?: Express.Multer.File,
  ): Promise<void> {
    let next = business.logo;
    if (logo) {
      next = await this.upload(logo);
      await this.storageService.deleteFile(business.logo);
    } else if (form.removeLogo === 'on' && business.logo) {
      await this.storageService.deleteFile(business.logo);
      next = null;
    }
    await this.update(
      { id: business.id },
      {
        name: form.name,
        email: form.email,
        phone: form.phone,
        address: form.address,
        logo: next,
      },
    );
  }

  async withCountry(id: number): Promise<Business | null> {
    return this.filter({ id }, { relations: { country: true } });
  }

  private async upload(image: Express.Multer.File): Promise<string> {
    try {
      return await this.storageService.uploadImage(image);
    } catch (error) {
      if (error instanceof BadRequestException)
        throw new FormError('Please fix the highlighted fields', {
          logo: error.message,
        });
      throw error;
    }
  }
}
