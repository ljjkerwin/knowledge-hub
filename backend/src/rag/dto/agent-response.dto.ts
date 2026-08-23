import { IsString, IsArray, IsNumber, ValidateNested, IsOptional, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class ReasoningStepDto {
  @IsString()
  step: string;

  @IsString()
  result: string;
}

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

export class AgentQueryResponseDto {
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

  @IsNumber()
  iterations: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReasoningStepDto)
  reasoning: ReasoningStepDto[];
}
