import {
  TypeOrmModule,
  TypeOrmModuleOptions,
  TypeOrmOptionsFactory,
} from '@nestjs/typeorm';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * DatabaseConfig class for configuring a read-only PostgreSQL database connection.
 * Implements TypeOrmOptionsFactory to provide dynamic configuration options
 * based on environment variables.
 */
@Injectable()
class DatabaseConfig implements TypeOrmOptionsFactory {
  constructor(private configService: ConfigService) {}

  /**
   * Creates and returns TypeORM configuration options for the PostgreSQL database.
   * @returns TypeOrmModuleOptions - Database connection options.
   */
  createTypeOrmOptions(): TypeOrmModuleOptions {
    return {
      type: 'postgres',
      host: this.configService.get<string>('DB_HOST'),
      port: this.configService.get<number>('DB_PORT'),
      username: this.configService.get<string>('DB_USER'),
      password: this.configService.get<string>('DB_PASSWORD'),
      database: this.configService.get<string>('DB_NAME'),
      // Each module registers its entities with TypeOrmModule.forFeature
      autoLoadEntities: true,
      synchronize: true,
    };
  }
}

export default TypeOrmModule.forRootAsync({
  imports: undefined,
  useClass: DatabaseConfig,
});
