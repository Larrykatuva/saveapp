import type { RedisClientOptions } from 'redis';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheModule, CacheOptionsFactory } from '@nestjs/cache-manager';

/**
 * Cache initializer class for Redis NoSQL database.
 * Implements CacheOptionsFactory to provide Redis-specific configuration
 * for NestJS CacheModule.
 */
@Injectable()
class RedisConfig implements CacheOptionsFactory {
  constructor(private configService: ConfigService) {}

  /**
   * Creates cache options specifically for Redis by configuring the
   * Redis URL and setting the cache-manager store to Redis.
   * @returns RedisClientOptions - Configuration options for Redis cache.
   */
  createCacheOptions(): RedisClientOptions {
    return {
      url: this.configService.get<string>('REDIS_URL'),
    };
  }
}

export default CacheModule.registerAsync({
  useClass: RedisConfig,
  imports: undefined,
  useExisting: undefined,
});
