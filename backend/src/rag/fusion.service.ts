import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RetrievedChunk } from './types/rag.types';

export type RetrievalSource = 'vector' | 'keyword' | 'graph';

export interface RankedRetrievalResult {
  source: RetrievalSource;
  chunks: RetrievedChunk[];
  weight?: number;
}

/** 使用 Weighted Reciprocal Rank Fusion（WRRF）合并异构检索结果。 */
@Injectable()
export class FusionService {
  private readonly rankConstant: number;
  private readonly sourceWeights: Record<RetrievalSource, number>;

  constructor(private readonly config: ConfigService) {
    this.rankConstant = Number(this.config.get('RAG_RRF_RANK_CONSTANT', 60));
    this.sourceWeights = {
      vector: Number(this.config.get('RAG_VECTOR_WEIGHT', 1)),
      keyword: Number(this.config.get('RAG_KEYWORD_WEIGHT', 1)),
      graph: Number(this.config.get('RAG_GRAPH_WEIGHT', 0.7)),
    };
  }

  fuse(results: RankedRetrievalResult[], limit: number): RetrievedChunk[] {
    const fused = new Map<string, { chunk: RetrievedChunk; score: number; sourceCount: number }>();

    for (const result of results) {
      const weight = result.weight ?? this.sourceWeights[result.source];
      result.chunks.forEach((chunk, index) => {
        const contribution = weight / (this.rankConstant + index + 1);
        const existing = fused.get(chunk.chunkId);
        if (existing) {
          existing.score += contribution;
          existing.sourceCount++;
          return;
        }
        fused.set(chunk.chunkId, { chunk, score: contribution, sourceCount: 1 });
      });
    }

    return Array.from(fused.values())
      .sort(
        (a, b) =>
          b.score - a.score || b.sourceCount - a.sourceCount ||
          a.chunk.chunkIndex - b.chunk.chunkIndex,
      )
      .slice(0, Math.max(1, limit))
      .map(({ chunk, score }) => ({ ...chunk, similarity: score }));
  }

  getSourceWeight(source: RetrievalSource): number {
    return this.sourceWeights[source];
  }
}
