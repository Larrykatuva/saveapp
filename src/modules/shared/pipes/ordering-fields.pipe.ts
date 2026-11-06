import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { SetEntity } from './search-fields.pipe';

/**
 * ORDERING_KEY is a constant used as the key for storing the metadata related to
 * ordering fields in a NestJS request handler. This is used in combination with the
 * SetMetadata function to specify which fields can be ordered for a particular entity.
 */
export const ORDERING_KEY = 'ordering';

/**
 * SetFields is a helper function that uses NestJS's SetMetadata to set custom metadata
 * for allowed ordering fields. It associates the list of fields passed as arguments
 * with the provided `ORDERING_KEY` metadata, which can then be accessed later
 * to validate and construct the ordering logic.
 *
 * @param fields - An array of strings representing the fields that can be used for ordering.
 */
const SetFields = (fields: string[]) => SetMetadata(ORDERING_KEY, fields);

/**
 * OrderingFields is a custom decorator used to enhance NestJS route handlers with
 * Swagger API documentation and metadata for ordering fields. It allows API users
 * to specify which fields can be used for ordering data and integrates this
 * functionality with the request-handling process.
 *
 * This decorator also generates Swagger API documentation for the `ordering` query parameter,
 * which can be used to specify ordering options for responses.
 *
 * @param entity - The name of the entity for which the ordering fields are defined.
 * @param params - A list of field names that are allowed to be used for ordering.
 * @returns The combined decorators which include both the Swagger API query parameter
 *          definition and the metadata for handling ordering fields.
 */
export const OrderingFields = (entity: string, ...params: string[]) => {
  ApiQuery({ name: 'ordering', type: String, required: false });
  return applyDecorators(
    SetEntity(entity),
    SetFields(params),
    ApiQuery({ name: 'ordering', type: String, required: false }),
  );
};
