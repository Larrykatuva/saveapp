import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AuthorizationLevel } from '../../authorization/entities/permission.entity';
import { EntityService } from '../../shared/services/entity.service';
import { pageCount, pageWindow } from '../../shared/utils/portal-view.util';
import { Requirement } from '../entities/requirement.entity';

export interface RequirementInputForm {
  country: number;
  level: AuthorizationLevel;
  name: string;
  input: Requirement['input'];
  comment?: string;
  required?: string;
}

@Injectable()
export class RequirementService extends EntityService<Requirement> {
  constructor(
    @InjectRepository(Requirement)
    private requirementRepository: Repository<Requirement>,
  ) {
    super();
    super.setRepository(this.requirementRepository);
  }

  /**
   * What a business must provide: the requirements for its country and
   * level. Required items come first.
   */
  async forBusiness(
    countryId: number | undefined,
    level: AuthorizationLevel,
  ): Promise<Requirement[]> {
    if (!countryId) return [];
    const requirements = await this.filterMany(
      { country: { id: countryId }, level },
      { order: { id: 'ASC' } },
    );
    return requirements.sort(
      (a, b) => Number(b.required) - Number(a.required) || a.id - b.id,
    );
  }

  async search(
    filters: { q?: string; country?: string; level?: string },
    page = 1,
  ) {
    const builder = this.requirementRepository
      .createQueryBuilder('requirement')
      .leftJoinAndSelect('requirement.country', 'country')
      .orderBy('requirement.createdAt', 'DESC');
    const term = (filters.q ?? '').trim();
    if (term)
      builder.andWhere(
        new Brackets((where) =>
          where
            .where('requirement.name ILIKE :term', { term: `%${term}%` })
            .orWhere('requirement.comment ILIKE :term', { term: `%${term}%` }),
        ),
      );
    if (Number(filters.country))
      builder.andWhere('country.id = :country', {
        country: Number(filters.country),
      });
    if (filters.level)
      builder.andWhere('requirement.level = :level', { level: filters.level });
    const window = pageWindow(page);
    const [items, total] = await builder
      .skip(window.skip)
      .take(window.take)
      .getManyAndCount();
    return { items, total, page: window.page, pages: pageCount(total) };
  }

  async saveForm(form: RequirementInputForm, id?: number) {
    return this.save({
      ...(id ? { id } : {}),
      country: { id: form.country } as never,
      level: form.level,
      name: form.name,
      input: form.input,
      comment: form.comment || (null as unknown as string),
      required: form.required === 'on',
    });
  }
}
