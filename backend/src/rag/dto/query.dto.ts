import { IsString, IsOptional, IsInt, Min, Max, IsEnum, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export enum SearchType {
  VECTOR = 'vector',
  KEYWORD = 'keyword',
  HYBRID = 'hybrid',
}

export class QueryRagDto {
  @IsString()
  question: string;

  @IsOptional()
  @IsEnum(SearchType)
  searchType?: SearchType = SearchType.HYBRID;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number = 5;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsString()
  authorId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsBoolean()
  includeRawChunks?: boolean = false;
}
