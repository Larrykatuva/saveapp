import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

export type FieldErrors = Record<string, string>;

/**
 * Validates a submitted form against a class-validator DTO and returns the
 * typed values plus the first error per field, ready to render inline.
 */
export async function validateForm<T extends object>(
  dto: new () => T,
  body: unknown,
): Promise<{ values: T; errors: FieldErrors }> {
  const values = plainToInstance(dto, body ?? {}, {
    excludeExtraneousValues: false,
  });
  const errors: FieldErrors = {};
  for (const error of await validate(values, { whitelist: true })) {
    const [message] = Object.values(error.constraints ?? {});
    if (message) errors[error.property] = message;
  }
  return { values, errors };
}

/**
 * Raised by services when a submitted form is valid in shape but rejected by
 * business rules (email taken, wrong code...). Controllers render the errors
 * next to the fields; `message` is shown as a banner.
 */
export class FormError extends Error {
  constructor(
    message: string,
    public readonly errors: FieldErrors = {},
  ) {
    super(message);
  }
}
