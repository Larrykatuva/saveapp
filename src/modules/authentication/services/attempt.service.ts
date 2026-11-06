import { Injectable } from '@nestjs/common';
import { CacheService } from '../../shared/services/cache.service';

/**
 * Counts failed attempts per key (e.g. `login:jane@x.com`) inside a time window
 * so sign in, code entry and resends can be throttled.
 */
@Injectable()
export class AttemptService {
  constructor(private readonly cacheService: CacheService) {}

  async isBlocked(key: string, limit: number): Promise<boolean> {
    return (
      ((await this.cacheService.get<number>(`attempts:${key}`)) ?? 0) >= limit
    );
  }

  async fail(key: string, windowMs: number): Promise<number> {
    const count =
      ((await this.cacheService.get<number>(`attempts:${key}`)) ?? 0) + 1;
    await this.cacheService.save(`attempts:${key}`, count, windowMs);
    return count;
  }

  async clear(key: string): Promise<void> {
    await this.cacheService.delete(`attempts:${key}`);
  }

  /** True while a cooldown (e.g. between resends) is still running. */
  async onCooldown(key: string): Promise<boolean> {
    return (await this.cacheService.get<boolean>(`cooldown:${key}`)) === true;
  }

  async startCooldown(key: string, ms: number): Promise<void> {
    await this.cacheService.save(`cooldown:${key}`, true, ms);
  }
}
