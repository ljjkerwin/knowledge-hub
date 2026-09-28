import { DraftAssessmentService } from './answer-evaluator.service';
import { GeneratedAnswer } from '../types/rag.types';

describe('DraftAssessmentService evaluation prompt', () => {
  it('provides the effective retrieved chunk count to the evaluator', () => {
    const answer: GeneratedAnswer = {
      answer: '第四局，林诗栋/蒯曼在 1-7 落后时以 11-9 逆转。',
      citations: [
        {
          index: 1,
          chunkId: 'chunk-1',
          documentId: 'document-1',
          documentTitle: '比赛报道',
          chunkContent: '第四局 1-7 落后，以 11-9 逆转。',
          similarity: 0.7,
        },
      ],
    };
    const buildEvaluationPrompt = (
      DraftAssessmentService.prototype as unknown as {
        buildEvaluationPrompt: (
          question: string,
          answer: GeneratedAnswer,
          context: { retrievedChunkCount: number },
        ) => string;
      }
    ).buildEvaluationPrompt;

    const prompt = buildEvaluationPrompt.call(
      {},
      '第四局情况是什么？',
      answer,
      { retrievedChunkCount: 1 },
    );

    expect(prompt).toContain('有效召回片段数：1');
    expect(prompt).toContain('已在草稿中引用的片段数：1');
  });
});
