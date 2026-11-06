import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Credential drawer; scopes and IPs are parsed by the controller. */
export class CredentialForm {
  @Transform(trim)
  @IsNotEmpty({ message: 'Give the key a name, e.g. Production server' })
  @MaxLength(60, { message: 'Keep the name under 60 characters' })
  name: string;
}

export class WebhookForm {
  @Transform(trim)
  @IsNotEmpty({ message: 'Enter the URL we should post events to' })
  @MaxLength(500, { message: 'Keep the URL under 500 characters' })
  url: string;

  @IsOptional()
  active?: string;
}
