import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../authentication/authentication.module';
import { SiteViewController } from './controllers/views/site.controller';

/** Public landing page and developer guide. */
@Module({
  imports: [AuthenticationModule],
  controllers: [SiteViewController],
})
export class SiteModule {}
