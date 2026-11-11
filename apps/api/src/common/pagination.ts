import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Paginated } from '@pitstop/shared-types';

export class PaginationQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export function offsetOf(query: PaginationQuery): number {
  return (query.page - 1) * query.pageSize;
}

export function paginated<T>(data: T[], total: number, query: PaginationQuery): Paginated<T> {
  return { data, total, page: query.page, pageSize: query.pageSize };
}
