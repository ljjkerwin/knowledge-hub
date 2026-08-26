import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryIntent } from './question-analyzer.service';
import { SearchType } from '../dto/query.dto';

// 检索策略
export interface RetrievalStrategy {
  searchType: SearchType;
  /** 最终送入生成阶段的片段数量 */
  topK: number;
  /** 每条 query 召回的候选数量；扩展查询合并后会截断为 topK */
  candidateTopK: number;
  expandQuery: boolean;
  useKnowledgeGraph: boolean;
  sourceWeights: {
    vector: number;
    keyword: number;
    graph: number;
  };
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
  selectStrategy(
    intent: QueryIntent,
    question: string,
    originalQuestion?: string,
  ): RetrievalStrategy {
    const strategy = this.getStrategyByIntent(intent);
    // 改写可能把“负责”变成“职责”等表达；联合原问题判断，避免丢失精确词和关系信号。
    const adjustedStrategy = this.applyQueryFeatures(
      strategy,
      question,
      originalQuestion,
    );

    this.logger.log(
      `选择检索策略: 意图=${intent}, 检索方式=${adjustedStrategy.searchType}, topK=${adjustedStrategy.topK}, 候选=${adjustedStrategy.candidateTopK}`,
    );

    return adjustedStrategy;
  }

  /**
   * 根据意图获取策略
   */
  private getStrategyByIntent(intent: QueryIntent): RetrievalStrategy {
    switch (intent) {
      case QueryIntent.FACTUAL:
        // 普通事实问题同时保留语义与精确术语召回。
        return {
          searchType: SearchType.HYBRID,
          topK: this.defaultTopK,
          candidateTopK: this.defaultTopK + 2,
          expandQuery: false,
          useKnowledgeGraph: false,
          sourceWeights: { vector: 1, keyword: 0.7, graph: 0.4 },
        };

      case QueryIntent.PROCEDURAL:
        // 流程问题：混合检索，需要更多上下文
        return {
          searchType: SearchType.HYBRID,
          topK: this.defaultTopK + 2,
          candidateTopK: this.defaultTopK + 4,
          expandQuery: true,
          useKnowledgeGraph: false,
          sourceWeights: { vector: 1, keyword: 0.8, graph: 0.6 },
        };

      case QueryIntent.COMPARATIVE:
        // 比较问题：混合检索，需要多个角度
        return {
          searchType: SearchType.HYBRID,
          topK: this.defaultTopK + 3,
          candidateTopK: this.defaultTopK + 5,
          expandQuery: true,
          useKnowledgeGraph: true,
          sourceWeights: { vector: 0.9, keyword: 0.7, graph: 1 },
        };

      case QueryIntent.EXPLANATORY:
        // 解释性问题：向量检索为主，语义理解
        return {
          searchType: SearchType.HYBRID,
          topK: this.defaultTopK + 1,
          candidateTopK: this.defaultTopK + 3,
          expandQuery: true,
          useKnowledgeGraph: false,
          sourceWeights: { vector: 1, keyword: 0.8, graph: 0.6 },
        };

      default:
        return {
          searchType: SearchType.HYBRID,
          topK: this.defaultTopK,
          candidateTopK: this.defaultTopK,
          expandQuery: false,
          useKnowledgeGraph: false,
          sourceWeights: { vector: 1, keyword: 0.8, graph: 0.5 },
        };
    }
  }

  /**
   * 关键词、图谱适用性均由 query 特征补充判断，不能只依赖问题意图。
   */
  private applyQueryFeatures(
    strategy: RetrievalStrategy,
    question: string,
    originalQuestion?: string,
  ): RetrievalStrategy {
    const featureText = [question, originalQuestion].filter(Boolean).join('\n');
    const hasStrongExactTerm =
      /\b[A-Z]{2,}[\d_-]*\b/.test(featureText) ||
      /\bv?\d+(?:\.\d+){1,}\b/i.test(featureText);
    const hasQuotedTerm = /["'“”‘’`]/.test(featureText);
    // 只有输入主体本身就是编号/版本时才使用 keyword-only；自然语言中出现缩写
    // 不应关闭语义召回，否则 OA、SRE 等词会让整句问题丢失相关文档。
    const isPureIdentifier =
      /^\s*["'“”‘’`]?(?:[A-Z]{2,}[A-Z\d_.-]*|v?\d+(?:\.\d+)+)["'“”‘’`]?\s*$/i.test(
        question,
      );
    const isGraphQuestion =
      /关系|关联|依赖|影响|导致|上下游|区别|对比|比较|相关|负责|职责|审批|隶属|管理|归属|谁/.test(
        featureText,
      );

    const adjusted = {
      ...strategy,
      useKnowledgeGraph: strategy.useKnowledgeGraph || isGraphQuestion,
    };

    if (isPureIdentifier) {
      return {
        ...adjusted,
        searchType: SearchType.KEYWORD,
        useKnowledgeGraph: false,
        sourceWeights: { vector: 0, keyword: 1.2, graph: 0 },
      };
    }

    if (hasStrongExactTerm) {
      return {
        ...adjusted,
        searchType: SearchType.HYBRID,
        sourceWeights: {
          vector: 0.8,
          keyword: 1.2,
          graph: adjusted.useKnowledgeGraph
            ? Math.max(adjusted.sourceWeights.graph, 0.8)
            : adjusted.sourceWeights.graph,
        },
      };
    }

    if (!hasQuotedTerm) return adjusted;

    return {
      ...adjusted,
      searchType: SearchType.HYBRID,
      sourceWeights: { vector: 0.6, keyword: 1.2, graph: 0.3 },
    };
  }
}
