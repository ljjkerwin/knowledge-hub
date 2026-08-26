import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { EmbeddingService } from '../pipeline/embedding.service';
import { RetrievedChunk, SearchOptions } from './types/rag.types';

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private readonly topK: number;
  private readonly similarityThreshold: number;
  private readonly keywordScoreThreshold: number;
  private readonly keywordScoreFloor: number;

  constructor(
    private readonly es: ElasticsearchService,
    private readonly embeddingService: EmbeddingService,
    private readonly config: ConfigService,
  ) {
    this.topK = Number(this.config.get('RAG_TOP_K', 5));
    this.similarityThreshold = Number(
      this.config.get('RAG_SIMILARITY_THRESHOLD', 0.7),
    );
    this.keywordScoreThreshold = Number(
      this.config.get('RAG_KEYWORD_SCORE_THRESHOLD', 10),
    );
    this.keywordScoreFloor = Number(
      this.config.get('RAG_KEYWORD_SCORE_FLOOR', 1),
    );
  }

  /**
   * 向量检索（kNN）
   */
  async vectorSearch(
    query: string,
    options?: SearchOptions,
  ): Promise<RetrievedChunk[]> {
    const topK = options?.topK || this.topK;
    const threshold = options?.similarityThreshold || this.similarityThreshold;

    try {
      // 1. 将查询文本转换为向量
      const queryVector = await this.embeddingService.embed(query);

      // 2. 构建 ES kNN 查询
      const response = await this.es.search({
        index: 'kh_chunk',
        body: {
          knn: {
            field: 'embedding',
            query_vector: queryVector,
            k: topK,
            num_candidates: topK * 10,
          },
          _source: [
            'chunk_id',
            'document_id',
            'document_title',
            'content',
            'heading',
            'chunk_index',
            'total_chunks',
            'category_id',
            'author_id',
            'team_id',
            'publish_time',
          ],
        },
      });

      // 3. 转换结果
      const chunks: RetrievedChunk[] = response.hits.hits
        .filter((hit) => hit._score && hit._score >= threshold)
        .map((hit) => {
          const source = hit._source as any;
          return {
            chunkId: source.chunk_id,
            documentId: source.document_id,
            documentTitle: source.document_title,
            content: source.content,
            heading: source.heading || null,
            chunkIndex: source.chunk_index,
            totalChunks: source.total_chunks,
            similarity: hit._score || 0,
            metadata: {
              categoryId: source.category_id,
              authorId: source.author_id,
              teamId: source.team_id,
              publishTime: source.publish_time,
            },
          };
        });

      this.logger.log(`向量检索完成，返回 ${chunks.length} 个结果`);
      return chunks;
    } catch (error) {
      this.logger.error(`向量检索失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 关键词检索（BM25）
   */
  async keywordSearch(
    query: string,
    options?: SearchOptions,
  ): Promise<RetrievedChunk[]> {
    const topK = options?.topK || this.topK;
    const threshold =
      options?.keywordScoreThreshold ?? this.keywordScoreThreshold;

    try {
      const response = await this.es.search({
        index: 'kh_chunk',
        body: {
          query: {
            bool: {
              should: [
                // 精确短语优先，解决制度名、公司名、项目编号被长查询稀释的问题。
                { match_phrase: { content: { query, boost: 4 } } },
                { match_phrase: { heading: { query, boost: 3 } } },
                { match_phrase: { document_title: { query, boost: 3 } } },
                {
                  multi_match: {
                    query,
                    fields: ['content^2', 'heading', 'document_title'],
                    type: 'best_fields',
                    fuzziness: 'AUTO',
                  },
                },
              ],
              minimum_should_match: 1,
              filter: this.buildFilters(options),
            },
          },
          size: topK,
          _source: [
            'chunk_id',
            'document_id',
            'document_title',
            'content',
            'heading',
            'chunk_index',
            'total_chunks',
            'category_id',
            'author_id',
            'team_id',
            'publish_time',
          ],
        },
      });

      // 固定阈值 10 对短词和中文分词过于苛刻。以本批最高分的一半作为自适应
      // 阈值，并保留可配置下限；后续还有融合与 reranker 负责过滤噪声。
      const topScore = Math.max(
        0,
        ...response.hits.hits.map((hit) => hit._score ?? 0),
      );
      const effectiveThreshold =
        topScore > 0
          ? Math.max(
              this.keywordScoreFloor,
              Math.min(threshold, topScore * 0.5),
            )
          : threshold;
      const chunks: RetrievedChunk[] = response.hits.hits
        .filter((hit) => hit._score != null && hit._score >= effectiveThreshold)
        .map((hit) => {
          const source = hit._source as any;
          return {
            chunkId: source.chunk_id,
            documentId: source.document_id,
            documentTitle: source.document_title,
            content: source.content,
            heading: source.heading || null,
            chunkIndex: source.chunk_index,
            totalChunks: source.total_chunks,
            similarity: hit._score || 0,
            metadata: {
              categoryId: source.category_id,
              authorId: source.author_id,
              teamId: source.team_id,
              publishTime: source.publish_time,
            },
          };
        });

      this.logger.log(
        `关键词检索完成，返回 ${chunks.length} 个结果，阈值=${effectiveThreshold.toFixed(2)}`,
      );
      return chunks;
    } catch (error) {
      this.logger.error(`关键词检索失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 构建过滤条件
   */
  private buildFilters(options?: SearchOptions): any[] {
    const filters: any[] = [];

    if (options?.categoryId) {
      filters.push({ term: { category_id: options.categoryId } });
    }

    if (options?.teamId) {
      filters.push({ term: { team_id: options.teamId } });
    }

    if (options?.authorId) {
      filters.push({ term: { author_id: options.authorId } });
    }

    // 只返回已发布的文档
    filters.push({ term: { doc_status: 1 } });

    return filters;
  }
}
