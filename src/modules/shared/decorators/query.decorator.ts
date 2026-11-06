import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FIELDS_KEY } from '../pipes/search-fields.pipe';
import { Reflector } from '@nestjs/core';
import { Between, LessThan, MoreThan } from 'typeorm';
import { Request } from 'express';

const addDateFilters = (request: Request, queryObject: object): object => {
  const {
    query: { startDate, endDate },
  } = request;
  if (startDate && endDate)
    queryObject['createdAt'] = Between(startDate, endDate);
  if (startDate && !endDate) queryObject['createdAt'] = MoreThan(startDate);
  if (endDate && !startDate) queryObject['createdAt'] = LessThan(endDate);
  return queryObject;
};

/**
 * QueryDecorator is a custom NestJS parameter decorator that generates dynamic query filters
 * for search functionality based on metadata provided by the `SearchFields` pipe.
 *
 * This decorator processes the query parameters in the request, matches them against the
 * fields defined for the search, and constructs a query object that can be used by TypeORM
 * to filter results in the database.
 *
 * The decorator generates dynamic query filters based on the search fields and request query parameters.
 * It supports single and nested field filtering, converting the query to a `Like` query for TypeORM.
 *
 * @param data - Custom data passed to the decorator (not used in this case).
 * @param context - The execution context containing request and metadata.
 * @returns A query object that can be used in the database query, containing filters for the search.
 */
export const QueryDecorator = createParamDecorator(
  (data: unknown, context: ExecutionContext): object => {
    const request: Request = context.switchToHttp().getRequest();
    const reflector = new Reflector();
    const searchFields = reflector.getAllAndOverride<string>(FIELDS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const queryObject: object = {};
    for (let i: number = 0; i < searchFields.length; i++) {
      if (request.query[searchFields[i]]) {
        const queryFields: string[] = searchFields[i].split('__');
        switch (queryFields.length) {
          case 1: {
            if (request['query'][searchFields[i]]) {
              queryObject[queryFields[0]] = request.query[searchFields[i]];
            }
            break;
          }
          case 2: {
            if (request['query'][searchFields[i]]) {
              if (!queryObject[queryFields[0]])
                queryObject[queryFields[0]] = {};
              queryObject[queryFields[0]][queryFields[1]] =
                request.query[searchFields[i]];
            }
            break;
          }
          default:
            break;
        }
      }
    }
    addDateFilters(request, queryObject);
    return queryObject;
  },
);
