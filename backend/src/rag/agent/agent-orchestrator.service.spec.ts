import { QueryIntent, RewrittenQuery } from './question-analyzer.service';
import { RetrievalStrategy } from './strategy-selector.service';
import { SearchType } from '../dto/query.dto';
import { AgentOrchestrator } from './agent-orchestrator.service';

describe('AgentOrchestrator retrieval query construction', () => {
  it('adds per-entity queries for comparative cross-document questions', () => {
    const analysis: RewrittenQuery = {
      rewritten: '财务审核员和 SRE 值班工程师的职责分别是什么？',
      intent: QueryIntent.COMPARATIVE,
      expandedQueries: ['角色职责对比'],
      entityTerms: ['财务审核员', 'SRE 值班工程师'],
      needsRetrieval: true,
    };
    const strategy: RetrievalStrategy = {
      searchType: SearchType.HYBRID,
      topK: 8,
      candidateTopK: 10,
      expandQuery: true,
      useKnowledgeGraph: true,
      sourceWeights: { vector: 0.8, keyword: 1.2, graph: 1 },
    };
    const buildRetrievalQueries = (
      AgentOrchestrator.prototype as unknown as {
        buildRetrievalQueries: (
          analysis: RewrittenQuery,
          strategy: RetrievalStrategy,
          originalQuery?: string,
        ) => Array<{ query: string; weight: number }>;
      }
    ).buildRetrievalQueries;

    const queries = buildRetrievalQueries.call(
      {},
      analysis,
      strategy,
      analysis.rewritten,
    );

    expect(queries.map((item) => item.query)).toEqual(
      expect.arrayContaining(['财务审核员', 'SRE 值班工程师']),
    );
    expect(queries.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1);
  });
});
