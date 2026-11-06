import {
  applyDecorators,
  HttpCode,
  HttpStatus,
  Type,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiQuery,
  getSchemaPath,
} from '@nestjs/swagger';
import { BadRequestDto, PaginatedResponseDto } from '../dtos/shared.dto';
import { PaginationInterceptor } from '../interceptors/pagination.interceptor';

/**
 * PaginationParams function for applying query parameter decorators to the
 * NestJS route handlers. This function simplifies the process of adding
 * pagination query parameters (`page` and `pageSize`) and date filters
 * (`startDate` and `endDate`) to Swagger API documentation and route handler metadata.
 *
 * @returns Decorator - A decorator that adds the `page` and `pageSize`
 * query parameters to the Swagger documentation for paginated routes.
 * These parameters are optional and allow the client to control the
 * pagination behavior by specifying which page of results to retrieve
 * and how many items per page.
 */
const PaginationParams = () => {
  return applyDecorators(
    ApiQuery({ name: 'page', type: Number, required: false }),
    ApiQuery({ name: 'pageSize', type: Number, required: false }),
    ApiQuery({ name: 'startDate', type: String, required: false }),
    ApiQuery({ name: 'endDate', type: String, required: false }),
  );
};

/**
 * PaginatedResponsePipe function for applying standardized response decorators
 * to NestJS route handlers that return paginated data. This function simplifies
 * the response handling by applying HTTP status codes, pagination parameters,
 * and Swagger API response types for paginated responses.
 *
 * @param dto - The Data Transfer Object (DTO) class used for the individual item
 * in the paginated response.
 * @param status - The HTTP status code to be applied to the response, such as
 * 200 for success or 400 for bad request.
 * @returns Decorator - A decorator that applies the specified HTTP status,
 * pagination query parameters, and Swagger API response metadata for the
 * paginated response.
 */
export const PaginatedResponsePipe = <T extends Type<any>>(
  dto: T,
  status: HttpStatus,
) => {
  return applyDecorators(
    PaginationParams(),
    ApiExtraModels(PaginatedResponseDto, dto),
    HttpCode(status),

    // Define the structure of a successful response (200 OK) in the Swagger
    // documentation. The response will include pagination metadata and an
    // array of items.
    ApiOkResponse({
      description: 'Successful request',
      schema: {
        allOf: [
          { $ref: getSchemaPath(PaginatedResponseDto) },
          {
            properties: {
              data: {
                type: 'array',
                items: { $ref: getSchemaPath(dto) },
              },
            },
          },
        ],
      },
    }),

    // Document a potential bad request response (400) in the API documentation.
    // This is useful for cases where invalid pagination parameters are passed.
    ApiBadRequestResponse({
      description: 'Bad request',
      type: BadRequestDto,
    }),
    UseInterceptors(PaginationInterceptor),
  );
};
