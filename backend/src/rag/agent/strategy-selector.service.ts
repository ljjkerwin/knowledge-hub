import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryIntent } from './question-analyzer.service';
import { SearchType } from '../types/search.types';

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
    // 所有知识问答先走同一套稳定的 Hybrid 基线。意图只决定是否值得
    // 展开查询或补充图谱，不再为每类意图维护一组未经独立评估的 TopK 和权重。
    const strategy = this.applyQueryFeatures(
      intent,
      question,
      originalQuestion,
    );

    this.logger.log(
      `选择检索策略: 意图=${intent}, 检索方式=${strategy.searchType}, topK=${strategy.topK}, 候选=${strategy.candidateTopK}`,
    );

    return strategy;
  }

  /**
   * 只保留与查询文本直接相关的特例：精确术语和图谱关系问题。
   */
  private applyQueryFeatures(
    intent: QueryIntent,
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
    const strategy: RetrievalStrategy = {
      searchType: SearchType.HYBRID,
      topK: this.defaultTopK,
      candidateTopK: this.defaultTopK + 2,
      // 多样化提问仍可使用分析器产生的扩展词；不再顺带扩大 TopK。
      expandQuery:
        intent === QueryIntent.PROCEDURAL ||
        intent === QueryIntent.COMPARATIVE ||
        intent === QueryIntent.EXPLANATORY,
      useKnowledgeGraph: intent === QueryIntent.COMPARATIVE || isGraphQuestion,
      sourceWeights: { vector: 1, keyword: 0.8, graph: 1 },
    };

    if (isPureIdentifier) {
      return {
        ...strategy,
        searchType: SearchType.KEYWORD,
        useKnowledgeGraph: false,
        sourceWeights: { vector: 0, keyword: 1.2, graph: 0 },
      };
    }

    if (hasStrongExactTerm) {
      return {
        ...strategy,
        searchType: SearchType.HYBRID,
        sourceWeights: {
          vector: 0.8,
          keyword: 1.2,
          graph: strategy.useKnowledgeGraph ? 1 : 0.5,
        },
      };
    }

    if (!hasQuotedTerm) return strategy;

    return {
      ...strategy,
      searchType: SearchType.HYBRID,
      sourceWeights: { vector: 0.6, keyword: 1.2, graph: 0.3 },
    };
  }
}
