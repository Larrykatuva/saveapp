import { ConfigModule } from '@nestjs/config';

/**
 * Initializes the ConfigModule to load environment variables
 * and makes it globally available throughout the application.
 */
export default ConfigModule.forRoot({ isGlobal: true });
