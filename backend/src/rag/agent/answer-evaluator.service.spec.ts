import { EvidenceAssessmentService } from './answer-evaluator.service';
import { RetrievedChunk } from '../types/rag.types';

const chunk = (chunkId: string, content: string): RetrievedChunk => ({
  chunkId,
  documentId: `document-${chunkId}`,
  documentTitle: '测试制度',
  content,
  heading: null,
  chunkIndex: 0,
  totalChunks: 1,
  similarity: 0.8,
  metadata: {},
});

describe('EvidenceAssessmentService', () => {
  it('short-circuits empty retrieval results without an LLM call', async () => {
    const service = Object.create(
      EvidenceAssessmentService.prototype,
    ) as EvidenceAssessmentService;

    await expect(
      service.assessEvidence(
        '差旅流程是什么？',
        [],
        [],
        [{ source: 'knowledge_base', query: '差旅流程是什么？' }],
        'knowledge_base',
        false,
        'knowledge_with_web_fallback',
      ),
    ).resolves.toEqual({
      verdict: 'empty',
      usableChunkIds: [],
      coveredAspects: [],
      missingAspects: [],
      shouldContinue: false,
      needsWebSearch: false,
      nextSearchSource: 'none',
      reasoning: '当前查询未召回任何知识，不再使用相近查询重复检索。',
    });
  });

  it('can switch an empty knowledge-base result to web search', async () => {
    const invoke = jest.fn().mockResolvedValue({
      verdict: 'empty',
      usableChunkIds: [],
      coveredAspects: [],
      missingAspects: ['公开的最新规则'],
      shouldContinue: true,
      needsWebSearch: true,
      nextSearchSource: 'web',
      webSearchQuery: '公开的最新规则 2026',
      newSearchAspect: '公网近期信息',
      reasoning: '问题依赖公开的近期信息。',
    });
    const service = new EvidenceAssessmentService({
      create: jest.fn(() => ({
        withStructuredOutput: jest.fn(() => ({ invoke })),
      })),
    } as never);

    await expect(
      service.assessEvidence(
        '最新规则是什么？',
        [],
        [],
        [{ source: 'knowledge_base', query: '最新规则是什么？' }],
        'knowledge_base',
        true,
        'knowledge_with_web_fallback',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        verdict: 'empty',
        shouldContinue: true,
        needsWebSearch: true,
        nextSearchSource: 'web',
        webSearchQuery: '公开的最新规则 2026',
      }),
    );
  });

  it('includes accepted evidence, current results and searched queries in the prompt', () => {
    const buildEvaluationPrompt = (
      EvidenceAssessmentService.prototype as unknown as {
        buildEvaluationPrompt: (
          question: string,
          currentChunks: RetrievedChunk[],
          acceptedChunks: RetrievedChunk[],
          searchHistory: Array<{
            source: 'knowledge_base' | 'web';
            query: string;
          }>,
          currentSource: 'knowledge_base' | 'web',
          webSearchAvailable: boolean,
          retrievalPolicy: 'web_only' | 'knowledge_with_web_fallback',
        ) => string;
      }
    ).buildEvaluationPrompt;

    const prompt = buildEvaluationPrompt.call(
      {},
      'A 和 B 的审批流程有什么区别？',
      [chunk('chunk-b', 'B 需要部门负责人审批。')],
      [chunk('chunk-a', 'A 需要财务负责人审批。')],
      [
        {
          source: 'knowledge_base',
          query: 'A 和 B 的审批流程有什么区别？',
        },
        { source: 'web', query: 'B 的审批节点和审批人' },
      ],
      'web',
      true,
      'knowledge_with_web_fallback',
    ) as string;

    expect(prompt).toContain('A 需要财务负责人审批。');
    expect(prompt).toContain('B 需要部门负责人审批。');
    expect(prompt).toContain('B 的审批节点和审批人');
    expect(prompt).toContain('id="chunk-b"');
  });
});
