import { Module } from '@nestjs/common';
import RedisConfig from '../../configs/redis.config';
import { CacheService } from './services/cache.service';
import { RequestService } from './services/request.service';
import { HttpModule } from '@nestjs/axios';
import { StorageService } from './services/storage.service';

@Module({
  imports: [RedisConfig, HttpModule],
  providers: [CacheService, RequestService, StorageService],
  exports: [CacheService, RequestService, StorageService],
})
export class SharedModule {}
