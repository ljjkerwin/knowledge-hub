import {
  IsString,
  IsArray,
  IsNumber,
  ValidateNested,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CitationDto {
  @IsNumber()
  index: number;

  @IsString()
  documentId: string;

  @IsString()
  documentTitle: string;

  @IsString()
  chunkContent: string;

  @IsString()
  @IsOptional()
  heading: string | null;

  @IsNumber()
  similarity: number;
}

export class RetrievedChunkDto {
  @IsString()
  chunkId: string;

  @IsString()
  documentId: string;

  @IsString()
  documentTitle: string;

  @IsString()
  content: string;

  @IsString()
  @IsOptional()
  heading: string | null;

  @IsNumber()
  chunkIndex: number;

  @IsNumber()
  totalChunks: number;

  @IsNumber()
  similarity: number;
}

export class RagQueryResponseDto {
  @IsString()
  answer: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CitationDto)
  citations: CitationDto[];

  @IsNumber()
  confidence: number;

  @IsString()
  queryId: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RetrievedChunkDto)
  retrievedChunks?: RetrievedChunkDto[];
}
