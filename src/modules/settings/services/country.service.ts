import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Business } from '../../onboarding/entities/business.entity';
import { Requirement } from '../../onboarding/entities/requirement.entity';
import { EntityService } from '../../shared/services/entity.service';
import { StorageService } from '../../shared/services/storage.service';
import { fileUrlSigner } from '../../shared/transformers/file-url.transformer';
import { FormError } from '../../shared/utils/form.util';
import { pageCount, pageWindow } from '../../shared/utils/portal-view.util';
import { CountryForm } from '../dtos/settings-form.dtos';
import { Country } from '../entities/country.entity';

/** True when a logo is an uploaded S3 object rather than an external url. */
export const isUploaded = (logo?: string | null) =>
  fileUrlSigner.isStoredKey(fileUrlSigner.toKey(logo));

/** Standard flag used when no flag image is uploaded. */
export const flagUrl = (code: string) =>
  `https://flagcdn.com/w80/${code.toLowerCase()}.png`;

@Injectable()
export class CountryService extends EntityService<Country> {
  constructor(
    @InjectRepository(Country) private countryRepository: Repository<Country>,
    @InjectRepository(Business)
    private businessRepository: Repository<Business>,
    @InjectRepository(Requirement)
    private requirementRepository: Repository<Requirement>,
    private readonly storageService: StorageService,
  ) {
    super();
    super.setRepository(this.countryRepository);
  }

  async search(query = '', page = 1) {
    const builder = this.countryRepository
      .createQueryBuilder('country')
      .orderBy('country.createdAt', 'DESC');
    const term = query.trim();
    if (term)
      builder.where(
        new Brackets((where) =>
          where
            .where('country.name ILIKE :term', { term: `%${term}%` })
            .orWhere('country.code ILIKE :term', { term: `%${term}%` }),
        ),
      );
    const window = pageWindow(page);
    const [items, total] = await builder
      .skip(window.skip)
      .take(window.take)
      .getManyAndCount();
    return { items, total, page: window.page, pages: pageCount(total) };
  }

  /** Businesses and requirements per country, for the table. */
  async usage(
    ids: number[],
  ): Promise<Record<number, { businesses: number; requirements: number }>> {
    if (!ids.length) return {};
    const count = async (
      repository: Repository<Business> | Repository<Requirement>,
      alias: string,
    ) =>
      (
        await repository
          .createQueryBuilder(alias)
          .select(`${alias}."countryId"`, 'countryId')
          .addSelect('COUNT(*)', 'count')
          .where(`${alias}."countryId" IN (:...ids)`, { ids })
          .groupBy(`${alias}."countryId"`)
          .getRawMany<{ countryId: number; count: string }>()
      ).reduce<Record<number, number>>(
        (map, row) => ({ ...map, [row.countryId]: Number(row.count) }),
        {},
      );
    const businesses = await count(this.businessRepository, 'business');
    const requirements = await count(this.requirementRepository, 'requirement');
    return Object.fromEntries(
      ids.map((id) => [
        id,
        {
          businesses: businesses[id] ?? 0,
          requirements: requirements[id] ?? 0,
        },
      ]),
    );
  }

  /** Active countries for pickers, alphabetical. */
  async activeOptions(): Promise<Country[]> {
    return this.filterMany({ active: true }, { order: { name: 'ASC' } });
  }

  /** Every country for admin filters, alphabetical. */
  async allOptions(): Promise<Country[]> {
    return this.filterMany({}, { order: { name: 'ASC' } });
  }

  /**
   * Creates or updates a country. An uploaded flag goes to S3 (replacing and
   * deleting any previous upload); otherwise the standard flag for the ISO
   * code is used and follows code changes.
   */
  async saveForm(
    form: CountryForm,
    id?: number,
    image?: Express.Multer.File,
  ): Promise<Country> {
    const clash = await this.filter({ code: form.code });
    if (clash && clash.id !== id)
      throw new FormError('Please fix the highlighted fields', {
        code: `${clash.name} already uses ${form.code}`,
      });

    const existing = id ? await this.filter({ id }) : null;
    const hadUpload = isUploaded(existing?.logo);
    let logo = flagUrl(form.code);
    if (image) {
      logo = await this.upload(image);
      if (hadUpload) await this.storageService.deleteFile(existing?.logo);
    } else if (hadUpload && form.removeLogo === 'on') {
      await this.storageService.deleteFile(existing?.logo);
    } else if (hadUpload && existing) {
      logo = existing.logo;
    }

    return this.save({
      ...(id ? { id } : {}),
      name: form.name,
      code: form.code,
      logo,
      active: form.active === 'on',
    });
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

  async remove(country: Country): Promise<void> {
    const usage = (await this.usage([country.id]))[country.id];
    if (usage.businesses || usage.requirements)
      throw new FormError(
        `${country.name} still has ${usage.businesses} business${usage.businesses === 1 ? '' : 'es'} and ${usage.requirements} requirement${usage.requirements === 1 ? '' : 's'}. Deactivate it instead.`,
      );
    await this.countryRepository.delete({ id: country.id });
    await this.storageService.deleteFile(country.logo);
  }
}
