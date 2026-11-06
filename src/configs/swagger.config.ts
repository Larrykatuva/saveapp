import { DocumentBuilder } from '@nestjs/swagger';

/**
 * SaveApp merchant API: get an access token with a credential's client id
 * and secret, then call the card endpoints with it as a Bearer token.
 */
const config = new DocumentBuilder()
  .setTitle('SaveApp Merchant API')
  .setDescription(
    'Issue and manage UnionPay cards for your customers. Create API credentials in the merchant portal (Integrations), exchange them for an access token at POST /api/auth/token, then send it as `Authorization: Bearer <token>`. Calls must come from an IP address listed on the credential.',
  )
  .setVersion('1.0')
  .addBearerAuth(
    {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      name: 'Authorization',
      in: 'header',
    },
    'access-token',
  )
  .build();

export default config;
