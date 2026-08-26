import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { EmbeddingService } from '../pipeline/embedding.service';
import { RetrievalService } from './retrieval.service';

describe('RetrievalService keyword search', () => {
  it('boosts exact phrases and adapts a high fixed threshold to the result set', async () => {
    const search = jest.fn().mockResolvedValue({
      hits: {
        hits: [
          {
            _score: 8,
            _source: {
              chunk_id: 'chunk-1',
              document_id: 'document-1',
              document_title: 'travel-policy',
              content: '发票抬头须为某某科技有限公司',
              heading: '报销提交流程',
              chunk_index: 0,
              total_chunks: 1,
            },
          },
          {
            _score: 3,
            _source: {
              chunk_id: 'chunk-2',
              document_id: 'document-2',
              document_title: 'other',
              content: '不相关内容',
              heading: null,
              chunk_index: 0,
              total_chunks: 1,
            },
          },
        ],
      },
    });
    const es = { search } as unknown as ElasticsearchService;
    const embeddingService = {} as EmbeddingService;
    const config = {
      get: jest.fn((key: string, defaultValue: unknown) => {
        if (key === 'RAG_KEYWORD_SCORE_THRESHOLD') return 10;
        if (key === 'RAG_KEYWORD_SCORE_FLOOR') return 1;
        return defaultValue;
      }),
    } as unknown as ConfigService;
    const service = new RetrievalService(es, embeddingService, config);

    const chunks = await service.keywordSearch('某某科技有限公司');

    expect(chunks.map((chunk) => chunk.chunkId)).toEqual(['chunk-1']);
    const request = search.mock.calls[0][0];
    expect(request.body.query.bool.minimum_should_match).toBe(1);
    expect(request.body.query.bool.should).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ match_phrase: expect.any(Object) }),
      ]),
    );
  });
});
