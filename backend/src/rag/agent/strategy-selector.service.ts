import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryIntent } from './question-analyzer.service';
import { SearchType } from '../dto/query.dto';

// 检索策略
export interface RetrievalStrategy {
  searchType: SearchType;
  topK: number;
  rerank: boolean;
  expandQuery: boolean;
  hybridAlpha?: number;
}

@Injectable()
export class StrategySelector {
  private readonly logger = new Logger(StrategySelector.name);
  private readonly defaultTopK: number;

  constructor(private readonly config: ConfigService) {
    this.defaultTopK = Number(this.config.get('RAG_TOP_K', 5));
  }

  /**
   * 根据问题意图选择检索策略
   */
  selectStrategy(intent: QueryIntent, question: string): RetrievalStrategy {
    const strategy = this.getStrategyByIntent(intent);

    this.logger.log(
      `选择检索策略: 意图=${intent}, 检索方式=${strategy.searchType}, topK=${strategy.topK}`,
    );

    return strategy;
  }

  /**
   * 根据意图获取策略
   */
  private getStrategyByIntent(intent: QueryIntent): RetrievalStrategy {
    switch (intent) {
      case QueryIntent.FACTUAL:
        // 事实性问题：向量检索为主，精确匹配
        return {
          searchType: SearchType.VECTOR,
          topK: this.defaultTopK,
          rerank: false,
          expandQuery: false,
        };

      case QueryIntent.PROCEDURAL:
        // 流程问题：混合检索，需要更多上下文
        return {
          searchType: SearchType.HYBRID,
          topK: this.defaultTopK + 2,
          rerank: true,
          expandQuery: true,
          hybridAlpha: 0.6,
        };

      case QueryIntent.COMPARATIVE:
        // 比较问题：混合检索，需要多个角度
        return {
          searchType: SearchType.HYBRID,
          topK: this.defaultTopK + 3,
          rerank: true,
          expandQuery: true,
          hybridAlpha: 0.5,
        };

      case QueryIntent.EXPLANATORY:
        // 解释性问题：向量检索为主，语义理解
        return {
          searchType: SearchType.HYBRID,
          topK: this.defaultTopK + 1,
          rerank: true,
          expandQuery: true,
          hybridAlpha: 0.7,
        };

      default:
        return {
          searchType: SearchType.HYBRID,
          topK: this.defaultTopK,
          rerank: false,
          expandQuery: false,
        };
    }
  }
}
