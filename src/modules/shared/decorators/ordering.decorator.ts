import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ORDERING_KEY } from '../pipes/ordering-fields.pipe';

enum ORDERING {
  ASC = 'ASC',
  DESC = 'DESC',
}

/**
 * OrderingDecorator is a custom NestJS parameter decorator designed to handle ordering
 * for incoming requests. It extracts an `ordering` query parameter from the request and
 * constructs an ordering object that can be used for sorting database results or other
 * data-fetching mechanisms.
 *
 * The decorator parses the `ordering` parameter, which may contain multiple fields
 * separated by '&', with optional '-' prefix to indicate descending order. It checks
 * each field against a list of allowed ordering fields (defined by `ORDERING_KEY`) and
 * constructs an ordering object in the format `{ field: 'ASC' | 'DESC' }`. If no `ordering`
 * parameter is provided, it defaults to ordering by `id` in descending order.
 *
 * The ordering object returned by this decorator can be used to apply sorting to queries
 * in database operations such as with TypeORM or other similar tools.
 *
 * @param data - Any custom data passed to the decorator (not used in this case).
 * @param context - The execution context containing information about the request and handler.
 * @returns An object containing ordering parameters, e.g., `{ fieldName: 'ASC' | 'DESC' }`,
 *          which can be used for sorting data in queries.
 */
export const OrderingDecorator = createParamDecorator(
  (data: unknown, context: ExecutionContext): object => {
    const {
      query: { ordering },
    } = context.switchToHttp().getRequest();
    const reflector = new Reflector();
    const orderingFields = reflector.getAllAndOverride<string>(ORDERING_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const orderingObject: object = {};
    if (ordering) {
      const requestOrdering: string[] = ordering.split('&');
      for (let i: number = 0; i < requestOrdering.length; i++) {
        let field: string = requestOrdering[i];
        if (field.charAt(0) === '-') field = field.slice(1);
        if (orderingFields.includes(field)) {
          orderingObject[field] =
            requestOrdering[i].charAt(0) == '-' ? ORDERING.DESC : ORDERING.ASC;
        }
      }
    } else {
      orderingObject['id'] = ORDERING.DESC;
    }
    return orderingObject;
  },
);
