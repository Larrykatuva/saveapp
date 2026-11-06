import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CardState } from '../../cards/entities/card.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/* ------------------------------ Token ------------------------------ */

export class TokenReqDto {
  @ApiProperty({ example: 'sa_3f9c0b6e2d1a4c7b8e5f60a1b2c3d4e5' })
  @IsString()
  @IsNotEmpty({ message: 'client_id is required' })
  client_id: string;

  @ApiProperty({ example: 'sas_Q2xpZW50U2VjcmV0RXhhbXBsZQ' })
  @IsString()
  @IsNotEmpty({ message: 'client_secret is required' })
  client_secret: string;
}

export class TokenResDto {
  @ApiProperty()
  access_token: string;

  @ApiProperty({ example: 'Bearer' })
  token_type: 'Bearer';

  @ApiProperty({
    example: 3600,
    description: 'Seconds until the token expires',
  })
  expires_in: number;

  @ApiProperty({ example: ['Card'], type: [String] })
  scopes: string[];
}

/* ------------------------------ Cards ------------------------------ */

export class CreateCardReqDto {
  @ApiProperty({
    example: '0712345678',
    description: 'Cardholder mobile number; one cardholder per number',
  })
  @Transform(trim)
  @Matches(/^\+?\d[\d ]{8,14}$/, { message: 'Enter a valid mobile number' })
  mobile: string;

  @ApiProperty({ example: 'Jane Wanjiku', description: 'Name on the card' })
  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ example: 'Savings group payout card' })
  @Transform(trim)
  @IsOptional()
  @MaxLength(300)
  description?: string;
}

export class CardholderResDto {
  @ApiProperty({ example: 'CH-000123' })
  alias: string;

  @ApiProperty({ example: '254712345678' })
  mobile: string | null;
}

export class CardResDto {
  @ApiProperty({
    example: 'CA-0009812',
    description: 'Card reference used in every card call',
  })
  reference: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ example: '623401••••••1234' })
  maskedNumber: string;

  @ApiProperty({ example: 'UnionPay' })
  type: string;

  @ApiProperty({ example: 'KES' })
  currency: string;

  @ApiProperty({ enum: CardState })
  status: CardState;

  @ApiProperty({ nullable: true })
  expiryDate: Date | null;

  @ApiProperty()
  issuedAt: Date;

  @ApiProperty({ type: CardholderResDto })
  cardholder: CardholderResDto;

  @ApiProperty()
  createdAt: Date;
}

export class CardDetailsResDto {
  @ApiProperty()
  reference: string;

  @ApiProperty({ example: '623401••••••1234' })
  maskedNumber: string;

  @ApiProperty({ example: '12/29', nullable: true })
  expiry: string | null;

  @ApiProperty({ enum: CardState })
  status: CardState;
}

export class CardBalanceResDto {
  @ApiProperty()
  reference: string;

  @ApiProperty({ example: 1250.5 })
  balance: number;

  @ApiProperty({ example: 'KES' })
  currency: string;
}

export class CardTransactionsQueryDto {
  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use YYYY-MM-DD' })
  fromDate?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use YYYY-MM-DD' })
  toDate?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  count?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class CardTransactionsResDto {
  @ApiProperty()
  reference: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Transactions as UnionPay reports them',
  })
  transactions: Record<string, unknown>[];

  @ApiProperty()
  count: number;
}

export class CardStatusReqDto {
  @ApiProperty({
    enum: ['block', 'unblock', 'terminate'],
    description: 'terminate is permanent',
  })
  @IsIn(['block', 'unblock', 'terminate'])
  action: 'block' | 'unblock' | 'terminate';

  @ApiProperty({ example: 'Customer reported the card lost' })
  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(200)
  reason: string;
}

export class ReplaceCardReqDto {
  @ApiProperty({ example: 'Card damaged' })
  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(200)
  reason: string;
}

export class CardsQueryDto {
  @ApiPropertyOptional({ enum: CardState })
  @IsOptional()
  @IsIn(Object.values(CardState))
  status?: CardState;

  @ApiPropertyOptional({ description: 'Only cards of this mobile number' })
  @IsOptional()
  @Transform(trim)
  mobile?: string;
}

/* ----------------------- Full card details (OTP) -------------------- */

export class CardDetailsChallengeResDto {
  @ApiProperty({
    example: 'chl_9f3c0b6e2d1a4c7b8e5f60a1b2c3d4e5',
    description: 'Send back with the code to /details/verify',
  })
  challengeId: string;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ example: 300, description: 'Seconds the code stays valid' })
  expiresIn: number;

  @ApiProperty({
    example: 1,
    description: 'Webhook endpoints the card.details_otp event was sent to',
  })
  sentTo: number;
}

export class VerifyCardDetailsReqDto {
  @ApiProperty({ example: 'chl_9f3c0b6e2d1a4c7b8e5f60a1b2c3d4e5' })
  @Transform(trim)
  @Matches(/^chl_[a-f0-9]{32}$/, { message: 'challengeId is not valid' })
  challengeId: string;

  @ApiProperty({
    example: '482913',
    description: 'The code from the card.details_otp webhook',
  })
  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'otp must be 6 digits' })
  otp: string;
}

export class FullCardDetailsResDto {
  @ApiProperty()
  reference: string;

  @ApiProperty({ example: 'Achieng Otieno' })
  name: string;

  @ApiProperty({ example: '6234010123454321', description: 'Full card number' })
  cardNumber: string;

  @ApiProperty({ example: '12/29', nullable: true })
  expiry: string | null;

  @ApiProperty({ example: '123' })
  cvv: string;

  @ApiProperty({ enum: CardState })
  status: CardState;
}
