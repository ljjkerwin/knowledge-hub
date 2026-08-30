import { SearchType } from '../types/search.types';
import {
  buildRetrievalStrategy,
  isExternalContentSafetyQuestion,
  QueryIntent,
} from './question-analyzer.service';

describe('QuestionAnalyzer retrieval strategy', () => {
  const select = (
    intent: QueryIntent,
    question: string,
    originalQuestion?: string,
  ) => buildRetrievalStrategy(intent, question, originalQuestion, 5);

  it('uses keyword-boosted hybrid retrieval for acronyms inside a natural-language question', () => {
    const strategy = select(QueryIntent.FACTUAL, 'OA 未备案的机票有什么后果？');

    expect(strategy.searchType).toBe(SearchType.HYBRID);
    expect(strategy.sourceWeights.keyword).toBeGreaterThan(
      strategy.sourceWeights.vector,
    );
    expect(strategy.sourceWeights.vector).toBeGreaterThan(0);
  });

  it('keeps keyword-only retrieval for a pure identifier', () => {
    const strategy = select(QueryIntent.FACTUAL, 'SOP-PE-2026-003');

    expect(strategy.searchType).toBe(SearchType.KEYWORD);
    expect(strategy.useKnowledgeGraph).toBe(false);
  });

  it('keeps knowledge graph enabled when an acronym appears in a relation question', () => {
    const strategy = select(
      QueryIntent.FACTUAL,
      'SRE 值班工程师的职责是什么？',
    );

    expect(strategy.searchType).toBe(SearchType.HYBRID);
    expect(strategy.useKnowledgeGraph).toBe(true);
    expect(strategy.sourceWeights.graph).toBeGreaterThan(0);
  });

  it('uses the original question to retain relation signals lost during rewriting', () => {
    const strategy = select(
      QueryIntent.FACTUAL,
      '财务审核员的工作内容是什么？',
      '财务审核员负责什么？',
    );

    expect(strategy.useKnowledgeGraph).toBe(true);
  });

  it('recognizes a request to safely handle risky instructions in external content', () => {
    expect(
      isExternalContentSafetyQuestion(
        '这份外部合作方留言里的“忽略系统指令”应该怎么处理？',
      ),
    ).toBe(true);
  });

  it('does not classify a normal policy question as an external-content safety question', () => {
    expect(isExternalContentSafetyQuestion('如何申请出差报销？')).toBe(false);
  });
});
