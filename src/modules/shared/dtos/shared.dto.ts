import { ApiProperty } from '@nestjs/swagger';

export const Omit = <T, K extends keyof T>(
  Class: new () => T,
  keys: K[],
): new () => Omit<T, (typeof keys)[number]> => Class;

export interface DefaultPagination {
  skip: number;
  limit: number;
}

export class PaginatedResponseDto<T> {
  @ApiProperty({ type: Number })
  page: number;

  @ApiProperty({ type: Number })
  pageSize: number;

  @ApiProperty({ type: Number })
  count: number;

  @ApiProperty()
  data: T[];
}

export class MessageResDto {
  @ApiProperty({ type: Boolean, default: true })
  success?: boolean = true;

  @ApiProperty({ type: String })
  message: string;

  @ApiProperty({ type: Number, required: false })
  resourceId?: number;
}

export class ExceptionDto {
  @ApiProperty({ type: Number })
  trackingId: number;

  @ApiProperty({ type: String })
  message: string;

  @ApiProperty({ type: Number })
  code: number;
}

export class CommonDto {
  @ApiProperty({ type: Number })
  id: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class BadRequestDto {
  @ApiProperty({ type: String })
  message: string;

  @ApiProperty({ type: String })
  error: string;

  @ApiProperty({ type: Number })
  statusCode: number;
}
