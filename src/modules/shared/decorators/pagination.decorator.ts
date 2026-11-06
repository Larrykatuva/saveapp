import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { DefaultPagination } from '../dtos/shared.dto';

/**
 * PaginationDecorator is a custom NestJS parameter decorator used to handle pagination
 * for incoming requests. It extracts pagination-related parameters (`page` and `pageSize`)
 * from the request query and transforms them into a format that can be used for paginated
 * queries, e.g., for database querying with TypeORM or any other pagination mechanism.
 *
 * This decorator supports pagination with limits, ensuring that `pageSize` does not exceed 50
 * to prevent overloading the server with large responses.
 *
 * @param data - Any custom data passed to the decorator (not used in this case).
 * @param context - The execution context containing information about the request and handler.
 * @returns An object containing pagination parameters in the format { take, skip } for querying.
 */
export const PaginationDecorator = createParamDecorator(
  (data: unknown, context: ExecutionContext): DefaultPagination => {
    const request = context.switchToHttp().getRequest<Request>();
    let {
      query: { page = 1, pageSize = 10 },
    } = request;
    if (parseInt(pageSize.toString()) > 50) pageSize = '50';
    return {
      take: parseInt(pageSize.toString()),
      skip:
        parseInt(page.toString()) == 1
          ? 0
          : parseInt(pageSize.toString()) * (parseInt(page.toString()) - 1),
    } as unknown as DefaultPagination;
  },
);
