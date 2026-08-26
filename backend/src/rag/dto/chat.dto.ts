import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ChatDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  maxIterations?: number = 2;

  @IsOptional()
  @IsBoolean()
  streamResponse?: boolean = true;

  /** 评估 Runner 使用：在检索事件中返回完整 chunk，普通聊天保持 200 字预览。 */
  @IsOptional()
  @IsBoolean()
  evaluationMode?: boolean = false;
}

export class ConversationListDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
