import { Client } from '@elastic/elasticsearch';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** ES 文档级全文检索索引名 */
const ES_INDEX = 'kh_document';
const IK_INDEX_ANALYZER = 'ik_max_word';
const IK_SEARCH_ANALYZER = 'ik_smart';

export interface FullTextSearchOptions {
  keyword: string;
  page: number;
  pageSize: number;
  userId: string;
  isAdmin: boolean;
}

/**
 * 文档级全文搜索索引
 *
 * <p>与 RAG 向量索引的区别：</p>
 * - 这里是「整篇文档」一条记录（标题/摘要/完整正文），给关键词搜索用
 * - RAG 是「多块 + 向量」，给语义检索用
 *
 * <p>仅写入 Elasticsearch `kh_document`；ES 不可用时跳过写入并打日志。</p>
 */
@Injectable()
export class SearchIndexService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SearchIndexService.name);
  private es: Client | null = null;
  private readonly esEnabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.esEnabled =
      this.config.get<string>('ELASTICSEARCH_ENABLED', 'true') !== 'false';
  }

  async onModuleInit() {
    if (!this.esEnabled) {
      this.logger.warn('Elasticsearch 已禁用，搜索索引将跳过写入');
      return;
    }

    const node =
      this.config.get<string>('ELASTICSEARCH_NODE') ?? 'http://localhost:9200';
    const password = this.config.get<string>('ELASTICSEARCH_PASSWORD') ?? '';
    this.es = new Client({
      node,
      auth: {
        username: 'elastic',
        password,
      },
    });
    try {
      const health = await this.es.cluster.health();
      this.logger.log(
        `SearchIndex ES 已连接：${node}, status=${health.status}`,
      );
      await this.ensureIkAnalyzer();
      await this.ensureEsIndex();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Elasticsearch 或 IK 分词器不可用，搜索索引将跳过写入：${message}`,
      );
      this.es = null;
    }
  }

  async onModuleDestroy() {
    await this.es?.close();
  }

  /**
   * Upsert 一篇文档的搜索记录。
   * @param doc 字段约定见 DocumentPipelinePublisher.buildSearchIndexData
   */
  async indexDocument(doc: Record<string, unknown>) {
    if (!this.es) {
      this.logger.warn(
        `跳过搜索索引写入（ES 不可用）：documentId=${String(doc.id)}`,
      );
      return;
    }

    const id = String(doc.id);
    await this.es.index({
      index: ES_INDEX,
      id,
      document: {
        ...doc,
        indexedAt: new Date().toISOString(),
      },
      refresh: true,
    });

    this.logger.debug(`搜索索引已写入 ES：documentId=${id}`);
  }

  /** 下架 / 删除时从 ES 移除 */
  async deleteDocument(documentId: string) {
    if (!this.es) {
      this.logger.warn(
        `跳过搜索索引删除（ES 不可用）：documentId=${documentId}`,
      );
      return;
    }

    try {
      await this.es.delete({
        index: ES_INDEX,
        id: documentId,
        refresh: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('404')) {
        this.logger.warn(`ES 删除失败：documentId=${documentId}, ${message}`);
      }
    }

    this.logger.log(`搜索索引已删除：documentId=${documentId}`);
  }

  /** 在标题、摘要和完整正文中执行关键词检索，并只返回当前用户可阅读的文档。 */
  async search(options: FullTextSearchOptions) {
    if (!this.es) {
      throw new ServiceUnavailableException('全文搜索服务暂不可用');
    }

    const visibilityFilters = options.isAdmin
      ? []
      : [
          {
            bool: {
              should: [
                { term: { isPublic: true } },
                { term: { authorId: options.userId } },
                { term: { createBy: options.userId } },
              ],
              minimum_should_match: 1,
            },
          },
        ];
    const response = await this.es.search<Record<string, unknown>>({
      index: ES_INDEX,
      from: (options.page - 1) * options.pageSize,
      size: options.pageSize,
      track_total_hits: true,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: options.keyword,
                fields: ['title^4', 'summary^2', 'content'],
                type: 'best_fields',
                operator: 'and',
                analyzer: IK_SEARCH_ANALYZER,
              },
            },
          ],
          filter: [{ term: { status: 1 } }, ...visibilityFilters],
        },
      },
      highlight: {
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
        fields: {
          title: { number_of_fragments: 0 },
          summary: { fragment_size: 180, number_of_fragments: 1 },
          content: { fragment_size: 180, number_of_fragments: 2 },
        },
      },
    });
    const total = response.hits.total;

    return {
      items: response.hits.hits.map((hit) => ({
        ...hit._source,
        score: hit._score,
        highlights: hit.highlight ?? {},
      })),
      total: typeof total === 'number' ? total : (total?.value ?? 0),
      page: options.page,
      pageSize: options.pageSize,
    };
  }

  /** 删除并以 IK mapping 重建全文索引；调用方须在停机窗口执行。 */
  async recreateIndex() {
    if (!this.es) {
      throw new ServiceUnavailableException('全文搜索服务暂不可用');
    }
    const exists = await this.es.indices.exists({ index: ES_INDEX });
    if (exists) {
      await this.es.indices.delete({ index: ES_INDEX });
    }
    await this.createIndex();
    this.logger.warn(`ES 全文索引已重建：${ES_INDEX}`);
  }

  /** 启动时校验 IK 插件，避免首次搜索时才暴露配置错误。 */
  private async ensureIkAnalyzer() {
    if (!this.es) return;
    await this.es.indices.analyze({
      analyzer: IK_SEARCH_ANALYZER,
      text: '全文检索分词器健康检查',
    });
  }

  /** 索引不存在则创建带 IK 分词的 mapping。 */
  private async ensureEsIndex() {
    if (!this.es) return;
    const exists = await this.es.indices.exists({ index: ES_INDEX });
    if (!exists) {
      await this.createIndex();
      this.logger.log(`已创建 ES 索引：${ES_INDEX}`);
    }
  }

  private async createIndex() {
    if (!this.es) return;
    await this.es.indices.create({
      index: ES_INDEX,
      mappings: {
        properties: {
          id: { type: 'keyword' },
          title: {
            type: 'text',
            analyzer: IK_INDEX_ANALYZER,
            search_analyzer: IK_SEARCH_ANALYZER,
          },
          summary: {
            type: 'text',
            analyzer: IK_INDEX_ANALYZER,
            search_analyzer: IK_SEARCH_ANALYZER,
          },
          content: {
            type: 'text',
            analyzer: IK_INDEX_ANALYZER,
            search_analyzer: IK_SEARCH_ANALYZER,
          },
          tags: { type: 'keyword' },
          status: { type: 'integer' },
          categoryId: { type: 'keyword' },
          authorId: { type: 'keyword' },
          createBy: { type: 'keyword' },
          publishTime: { type: 'date' },
        },
      },
    });
  }
}
