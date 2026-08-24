import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AgentQueryDto {
  @IsString()
  question: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  maxIterations?: number = 3;

  @IsOptional()
  @IsBoolean()
  enableFollowUp?: boolean = true;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  teamId?: string;
}
