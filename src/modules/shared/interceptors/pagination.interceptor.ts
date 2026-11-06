import { Request } from 'express';
import { PaginatedResponseDto } from '../dtos/shared.dto';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Helper function to format the paginated response data.
 *
 * This function formats the paginated data by taking the response from the database (an array of data and a count)
 * and the request object to include pagination metadata such as page number, page size, total count of records,
 * and the actual data for that page.
 *
 * @param data - The data returned from the database, which is an array containing the paginated records and total count.
 * @param request - The request object, used to extract pagination query parameters.
 * @returns A PaginatedResponseDto object with the formatted pagination data.
 */
const formatData = <T>(
  data: [T[], number],
  request: Request,
): PaginatedResponseDto<T> => {
  const {
    query: { page = 1, pageSize = 10 },
  } = request;
  return {
    page: Math.max(1, parseInt(page.toString()) || 1),
    // Same cap as PaginationDecorator
    pageSize: Math.min(50, parseInt(pageSize.toString()) || 10),
    count: data[1],
    data: data[0],
  };
};

/**
 * PaginationInterceptor class to handle pagination logic for incoming requests.
 *
 * This interceptor processes the response by formatting it into a paginated response
 * using the PaginatedResponseDto format, ensuring that metadata such as current page,
 * page size, total count, and the actual data are returned in the response.
 */
@Injectable()
export class PaginationInterceptor<T> implements NestInterceptor<
  T,
  PaginatedResponseDto<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<PaginatedResponseDto<T>> {
    const request = context.switchToHttp().getRequest();
    return next
      .handle()
      .pipe(map((data: [T[], number]) => formatData<T>(data, request)));
  }
}
