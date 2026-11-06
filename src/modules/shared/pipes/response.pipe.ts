import { applyDecorators, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { BadRequestDto } from '../dtos/shared.dto';

/**
 * ResponsePipe function for applying standardized response decorators to
 * NestJS route handlers. This function enhances the response handling
 * by applying HTTP status codes and API response types.
 *
 * @param dto - The Data Transfer Object (DTO) class used for the response type.
 * @param status - The HTTP status code to be applied to the response.
 * @returns Decorator - A decorator that applies the specified HTTP status
 * and Swagger API response metadata.
 */
export const ResponsePipe = <T>(dto: any, status: HttpStatus) => {
  return applyDecorators(
    // Set the HTTP response status code
    HttpCode(status),

    // Apply a response decorator based on the provided status
    status == HttpStatus.CREATED
      ? ApiCreatedResponse({
          description: 'Successful Request',
          type: dto,
        })
      : ApiOkResponse({
          description: 'Successful Request',
          type: dto,
        }),
    ApiBadRequestResponse({
      description: 'Bad request',
      type: BadRequestDto,
    }),
  );
};
