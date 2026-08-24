import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import SnowflakeId from 'snowflake-id';
import { RetrievalService } from './retrieval.service';
import { GenerationService } from './generation.service';
import { QueryRagDto, SearchType } from './dto/query.dto';
import { RagQueryResponseDto } from './dto/response.dto';
import { RetrievedChunk } from './types/rag.types';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly retrievalService: RetrievalService,
    private readonly generationService: GenerationService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 单轮 RAG 查询
   */
  async query(dto: QueryRagDto, userId: string): Promise<RagQueryResponseDto> {
    const queryId = this.generateQueryId();
    this.logger.log(`开始 RAG 查询 [${queryId}]: ${dto.question}`);

    try {
      // 1. 检索相关 chunks
      const chunks = await this.retrieve(dto, userId);

      if (chunks.length === 0) {
        this.logger.warn(`未找到相关文档 [${queryId}]`);
        return {
          answer:
            '抱歉，未找到与您问题相关的文档内容。请尝试换个问题或检查知识库是否有相关内容。',
          citations: [],
          confidence: 0,
          queryId,
          retrievedChunks: [],
        };
      }

      // 2. 生成答案
      const result = await this.generationService.generate(
        dto.question,
        chunks,
      );

      this.logger.log(
        `RAG 查询完成 [${queryId}]，置信度: ${result.confidence}`,
      );

      return {
        answer: result.answer,
        citations: result.citations,
        confidence: result.confidence,
        queryId,
        retrievedChunks: dto.includeRawChunks ? chunks : undefined,
      };
    } catch (error) {
      this.logger.error(`RAG 查询失败 [${queryId}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * 流式 RAG 查询
   */
  async *queryStream(
    dto: QueryRagDto,
    userId: string,
  ): AsyncGenerator<{ type: string; content: any }> {
    const queryId = this.generateQueryId();
    this.logger.log(`开始流式 RAG 查询 [${queryId}]: ${dto.question}`);

    try {
      // 1. 返回查询 ID
      yield { type: 'queryId', content: queryId };

      // 2. 检索相关 chunks
      const chunks = await this.retrieve(dto, userId);

      if (chunks.length === 0) {
        yield {
          type: 'answer',
          content:
            '抱歉，未找到与您问题相关的文档内容。请尝试换个问题或检查知识库是否有相关内容。',
        };
        yield { type: 'citations', content: [] };
        yield { type: 'confidence', content: 0 };
        yield { type: 'done', content: true };
        return;
      }

      // 3. 返回检索结果数量
      yield { type: 'retrieved_count', content: chunks.length };

      // 4. 流式生成答案
      for await (const chunk of this.generationService.generateStream(
        dto.question,
        chunks,
      )) {
        yield chunk;
      }

      // 5. 完成
      yield { type: 'done', content: true };

      this.logger.log(`流式 RAG 查询完成 [${queryId}]`);
    } catch (error) {
      this.logger.error(`流式 RAG 查询失败 [${queryId}]: ${error.message}`);
      yield { type: 'error', content: error.message };
    }
  }

  /**
   * 执行检索
   */
  private async retrieve(
    dto: QueryRagDto,
    userId: string,
  ): Promise<RetrievedChunk[]> {
    const options = {
      topK: dto.topK,
      categoryId: dto.categoryId,
      teamId: dto.teamId,
      authorId: dto.authorId,
      userId,
    };

    switch (dto.searchType) {
      case SearchType.VECTOR:
        return this.retrievalService.vectorSearch(dto.question, options);
      case SearchType.KEYWORD:
        return this.retrievalService.keywordSearch(dto.question, options);
      case SearchType.HYBRID:
      default:
        return this.retrievalService.hybridSearch(dto.question, options);
    }
  }

  /**
   * 生成查询 ID
   */
  private generateQueryId(): string {
    const snowflake = new SnowflakeId();
    return `query_${snowflake.generate()}`;
  }
}
