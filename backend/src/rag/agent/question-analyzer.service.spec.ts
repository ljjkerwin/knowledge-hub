import { SearchType } from '../types/search.types';
import {
  buildRetrievalStrategy,
  isExternalContentSafetyQuestion,
  QuestionAnalyzer,
  QueryIntent,
} from './question-analyzer.service';

describe('QuestionAnalyzer retrieval strategy', () => {
  const select = (
    intent: QueryIntent,
    question: string,
    originalQuestion?: string,
  ) => buildRetrievalStrategy(intent, question, originalQuestion, 5);

  it('uses keyword-boosted hybrid retrieval for acronyms inside a natural-language question', () => {
    const strategy = select(
      QueryIntent.KNOWLEDGE_BASE,
      'OA 未备案的机票有什么后果？',
    );

    expect(strategy.searchType).toBe(SearchType.HYBRID);
    expect(strategy.sourceWeights.keyword).toBeGreaterThan(
      strategy.sourceWeights.vector,
    );
    expect(strategy.sourceWeights.vector).toBeGreaterThan(0);
  });

  it('keeps keyword-only retrieval for a pure identifier', () => {
    const strategy = select(QueryIntent.KNOWLEDGE_BASE, 'SOP-PE-2026-003');

    expect(strategy.searchType).toBe(SearchType.KEYWORD);
    expect(strategy.useKnowledgeGraph).toBe(false);
  });

  it('keeps knowledge graph enabled when an acronym appears in a relation question', () => {
    const strategy = select(
      QueryIntent.KNOWLEDGE_BASE,
      'SRE 值班工程师的职责是什么？',
    );

    expect(strategy.searchType).toBe(SearchType.HYBRID);
    expect(strategy.useKnowledgeGraph).toBe(true);
    expect(strategy.sourceWeights.graph).toBeGreaterThan(0);
  });

  it('uses the original question to retain relation signals lost during rewriting', () => {
    const strategy = select(
      QueryIntent.KNOWLEDGE_BASE,
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

describe('QuestionAnalyzer four-way routing', () => {
  it.each([
    [QueryIntent.PERSONAL_PREFERENCE, false, false],
    [QueryIntent.WEB, true, false],
    [QueryIntent.KNOWLEDGE_BASE, true, true],
  ] as const)(
    'derives retrieval behavior from %s instead of a model boolean',
    async (intent, needsRetrieval, hasStrategy) => {
      const analyzer = createAnalyzer(intent);

      const result = await analyzer.analyze({
        question: '请处理这个测试问题',
        context: { history: [], conversationId: 'conversation-1' },
      });

      expect(result.intent).toBe(intent);
      expect(result.needsRetrieval).toBe(needsRetrieval);
      expect(Boolean(result.strategy)).toBe(hasStrategy);
      if (!hasStrategy) {
        expect(result.expandedQueries).toEqual([]);
        expect(result.entityTerms).toEqual([]);
      }
    },
  );

  it('keeps simple chitchat on the direct route without calling the model', async () => {
    const invoke = jest.fn();
    const analyzer = createAnalyzer(QueryIntent.KNOWLEDGE_BASE, invoke);

    const result = await analyzer.analyze({
      question: '你好',
      context: { history: [], conversationId: 'conversation-1' },
    });

    expect(result.intent).toBe(QueryIntent.CHITCHAT);
    expect(result.needsRetrieval).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});

function createAnalyzer(
  intent: QueryIntent,
  invoke = jest.fn().mockResolvedValue({
    rewritten: '请处理这个测试问题',
    intent,
    expandedQueries: ['模型生成的扩展词'],
    entityTerms: ['模型生成的实体词'],
  }),
): QuestionAnalyzer {
  return new QuestionAnalyzer(
    {
      create: jest.fn(() => ({
        withStructuredOutput: jest.fn(() => ({ invoke })),
      })),
    } as never,
    { get: jest.fn((_key: string, fallback: unknown) => fallback) } as never,
  );
}
