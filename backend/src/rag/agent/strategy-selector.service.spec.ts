import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { SearchType } from '../types/search.types';
import { QueryIntent } from './question-analyzer.service';
import { StrategySelector } from './strategy-selector.service';

describe('StrategySelector', () => {
  let selector: StrategySelector;

  beforeEach(() => {
    const config = {
      get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
    } as unknown as ConfigService;
    selector = new StrategySelector(config);
  });

  it('uses keyword-boosted hybrid retrieval for acronyms inside a natural-language question', () => {
    const strategy = selector.selectStrategy(
      QueryIntent.FACTUAL,
      'OA 未备案的机票有什么后果？',
    );

    expect(strategy.searchType).toBe(SearchType.HYBRID);
    expect(strategy.sourceWeights.keyword).toBeGreaterThan(
      strategy.sourceWeights.vector,
    );
    expect(strategy.sourceWeights.vector).toBeGreaterThan(0);
  });

  it('keeps keyword-only retrieval for a pure identifier', () => {
    const strategy = selector.selectStrategy(
      QueryIntent.FACTUAL,
      'SOP-PE-2026-003',
    );

    expect(strategy.searchType).toBe(SearchType.KEYWORD);
    expect(strategy.useKnowledgeGraph).toBe(false);
  });

  it('keeps knowledge graph enabled when an acronym appears in a relation question', () => {
    const strategy = selector.selectStrategy(
      QueryIntent.FACTUAL,
      'SRE 值班工程师的职责是什么？',
    );

    expect(strategy.searchType).toBe(SearchType.HYBRID);
    expect(strategy.useKnowledgeGraph).toBe(true);
    expect(strategy.sourceWeights.graph).toBeGreaterThan(0);
  });

  it('uses the original question to retain relation signals lost during rewriting', () => {
    const strategy = selector.selectStrategy(
      QueryIntent.FACTUAL,
      '财务审核员的工作内容是什么？',
      '财务审核员负责什么？',
    );

    expect(strategy.useKnowledgeGraph).toBe(true);
  });
});
