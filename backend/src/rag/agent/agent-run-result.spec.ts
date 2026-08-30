import { AgentRunResultCollector } from './agent-run-result';
import { AguiEventType } from '../types/agui.types';

describe('AgentRunResultCollector', () => {
  it('aggregates a RAG execution without relying on HTTP or SSE metadata', () => {
    const collector = new AgentRunResultCollector('eval_case_1', 1_000);

    collector.consume(
      {
        type: AguiEventType.ANALYSIS,
        timestamp: 1_010,
        rewritten: '差旅报销流程是什么？',
        intent: 'procedural',
        needsRetrieval: true,
        entityTerms: ['差旅报销'],
      },
      1_010,
    );
    collector.consume(
      {
        type: AguiEventType.RETRIEVAL_START,
        timestamp: 1_020,
        query: '差旅报销流程是什么？',
        searchType: 'hybrid',
      },
      1_020,
    );
    collector.consume(
      {
        type: AguiEventType.RETRIEVAL_RESULT,
        timestamp: 1_030,
        chunks: [
          {
            chunkId: 'chunk_1',
            documentId: 'doc_1',
            documentTitle: '差旅制度',
            content: '先提交申请。',
            similarity: 0.9,
          },
        ],
      },
      1_030,
    );
    collector.consume(
      {
        type: AguiEventType.DRAFT_ASSESSMENT,
        timestamp: 1_040,
        answerRelevance: 0.9,
        answerCompleteness: 0.8,
        shouldRetrieveMore: false,
      },
      1_040,
    );
    collector.consume(
      {
        type: AguiEventType.TEXT,
        timestamp: 1_050,
        content: '先提交申请。',
      },
      1_050,
    );
    collector.consume(
      {
        type: AguiEventType.DONE,
        timestamp: 1_060,
        queryId: 'eval_case_1',
        totalIterations: 1,
      },
      1_060,
    );

    expect(collector.finish(1_080)).toEqual({
      queryId: 'eval_case_1',
      route: 'rag',
      answer: '先提交申请。',
      citations: [
        {
          index: 1,
          chunkId: 'chunk_1',
          documentId: 'doc_1',
          documentTitle: '差旅制度',
          chunkContent: '先提交申请。',
          heading: null,
          similarity: 0.9,
        },
      ],
      analyses: [
        {
          rewritten: '差旅报销流程是什么？',
          intent: 'procedural',
          needsRetrieval: true,
          entityTerms: ['差旅报销'],
        },
      ],
      retrievalQueries: ['差旅报销流程是什么？'],
      draftAssessments: [
        {
          answerRelevance: 0.9,
          answerCompleteness: 0.8,
          shouldRetrieveMore: false,
        },
      ],
      totalIterations: 1,
      completed: true,
      timings: {
        totalMs: 80,
        timeToFirstEventMs: 10,
        timeToFirstTextMs: 50,
      },
    });
  });
});
