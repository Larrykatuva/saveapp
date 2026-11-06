import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';

/**
 * CacheService class for managing caching operations.
 * Utilizes the NestJS cache manager and config service to control
 * cache behavior based on application configuration.
 */
@Injectable()
export class CacheService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private configService: ConfigService,
  ) {}

  /**
   * Checks if caching is enabled based on application configuration.
   * @returns {boolean} - True if caching is enabled, false otherwise.
   */
  private isCacheEnabled(): boolean {
    return <boolean>this.configService.get<boolean>('CACHE_ENABLED')
      ? <boolean>this.configService.get<boolean>('CACHE_ENABLED')
      : true;
  }

  /**
   * Saves data to the cache with a specified key and duration.
   * @param key - The key under which the data will be stored.
   * @param data - The data to be cached.
   * @param duration - The duration for which the data should be cached (default: configured PERSISTENCE_TIME).
   */
  public async save<T>(key: string, data: T, duration = 60000): Promise<void> {
    if (this.isCacheEnabled()) await this.cacheManager.set(key, data, duration);
  }

  /**
   * Retrieves data from the cache by key.
   * @param key - The key associated with the cached data.
   * @returns {Promise<R | null>} - The cached data if found, or null if not found or caching is disabled.
   */
  async get<R>(key: string): Promise<R | null> {
    if (!this.isCacheEnabled()) return null;

    const value = await this.cacheManager.get<R>(key);
    return value === undefined ? null : value;
  }

  /**
   * Deletes data from the cache by key.
   * @param key - The key associated with the cached data to be deleted.
   */
  async delete(key: string): Promise<void> {
    if (this.isCacheEnabled()) await this.cacheManager.del(key);
  }

  /**
   * Resets the entire cache, removing all cached data.
   */
  async reset(): Promise<void> {
    if (this.isCacheEnabled()) await this.cacheManager.clear();
  }
}
