import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';

/**
 * Define constant keys for metadata storage
 */
export const ENTITY_KEY = 'entity';
export const FIELDS_KEY = 'fields';

// Function to set the 'entity' metadata on a handler or class
export const SetEntity = (entity: string) => SetMetadata(ENTITY_KEY, entity);
//Function to set the 'entity' metadata on a handler or class
const SetFields = (fields: string[]) => SetMetadata(FIELDS_KEY, fields);

/**
 * SearchFields function for applying multiple decorators to a NestJS route handler.
 * This function standardizes the handling of search queries by applying query
 * parameters to the Swagger documentation and metadata related to the entity
 * and its fields.
 *
 * @param entity - The name of the entity to be searched.
 * @param params - A list of field names to be used as query parameters for searching.
 * @returns Decorator - A decorator that applies metadata for the entity, fields,
 * and query parameters to the route handler.
 */
export const SearchFields = (entity: string, ...params: string[]) => {
  const queries: (MethodDecorator & ClassDecorator)[] = [];
  for (let i = 0; i < params.length; i++) {
    queries.push(ApiQuery({ name: params[i], type: String, required: false }));
  }
  return applyDecorators(SetEntity(entity), SetFields(params), ...queries);
};
