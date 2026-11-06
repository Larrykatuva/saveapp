import { FindOneOptions, FindOptionsWhere } from 'typeorm';
import { Repository } from 'typeorm/repository/Repository';
import { Logger } from '@nestjs/common';
import { DefaultPagination } from '../dtos/shared.dto';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import * as Sentry from '@sentry/node';

export class EntityService<T extends object> {
  private entityRepository: Repository<T>;
  private entityLogger: Logger;

  constructor() {
    this.entityLogger = new Logger('EntityService');
  }

  setRepository(repository: Repository<T>): void {
    this.entityRepository = repository;
  }

  async filter(
    filters: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    options?: FindOneOptions<T>,
  ): Promise<T | null> {
    try {
      return await this.entityRepository.findOne({
        where: filters,
        ...options,
      });
    } catch (error) {
      Sentry.captureException(error);
      this.entityLogger.error(error);
      throw error;
    }
  }

  async filterMany(
    filters: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    options?: FindOneOptions<T>,
  ): Promise<T[]> {
    try {
      return await this.entityRepository.find({
        where: filters,
        ...options,
      });
    } catch (error) {
      Sentry.captureException(error);
      this.entityLogger.error(error);
      throw error;
    }
  }

  async save(entity: Partial<T>): Promise<T> {
    try {
      return await this.entityRepository.save(entity as unknown as T);
    } catch (error) {
      Sentry.captureException(error);
      this.entityLogger.error(error);
      throw error;
    }
  }

  async saveMany(entity: Partial<T[]>): Promise<T[]> {
    try {
      return await this.entityRepository.save(entity as unknown as T[]);
    } catch (error) {
      Sentry.captureException(error);
      this.entityLogger.error(error);
      throw error;
    }
  }

  async paginatedFilter(
    pagination: DefaultPagination,
    filters?: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    options?: FindOneOptions<T>,
  ): Promise<[T[], number]> {
    try {
      return await this.entityRepository.findAndCount({
        where: filters,
        ...pagination,
        ...options,
      });
    } catch (error) {
      Sentry.captureException(error);
      this.entityLogger.error(error);
      throw error;
    }
  }

  async update(
    filters: FindOptionsWhere<T>,
    payload: Partial<T>,
  ): Promise<T | null> {
    try {
      await this.entityRepository.update(
        filters,
        payload as QueryDeepPartialEntity<T>,
      );
      return await this.filter(filters);
    } catch (error) {
      Sentry.captureException(error);
      this.entityLogger.error(error);
      throw error;
    }
  }

  async delete(filters: FindOptionsWhere<T>): Promise<void> {
    try {
      await this.entityRepository.delete(filters);
    } catch (error) {
      Sentry.captureException(error);
      this.entityLogger.error(error);
      throw error;
    }
  }
}
