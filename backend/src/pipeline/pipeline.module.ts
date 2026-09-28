import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DocumentContent,
  DocumentContentSchema,
} from '../document/schemas/document-content.schema';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { ExtractionService } from './extraction.service';
import { GraphBuildService } from './graph-build.service';
import { PipelineOrchestrator } from './pipeline.orchestrator';
import { SearchIndexService } from './search-index.service';
import { VectorIndexService } from './vector-index.service';
import { LlmModule } from '../llm/llm.module';
import { KnowledgeGraphController } from './knowledge-graph.controller';
import { ChunkStoreService } from './chunk-store.service';
import { OcrService } from './ocr.service';
import {
  StoredDocumentChunk,
  StoredDocumentChunkSchema,
} from './schemas/document-chunk.schema';
import { ParsedBlock, ParsedBlockSchema } from './schemas/parsed-block.schema';
import { ParsedBlockService } from './parsed-block.service';

@Module({
  imports: [
    LlmModule,
    MongooseModule.forFeature([
      { name: DocumentContent.name, schema: DocumentContentSchema },
      { name: StoredDocumentChunk.name, schema: StoredDocumentChunkSchema },
      { name: ParsedBlock.name, schema: ParsedBlockSchema },
    ]),
  ],
  providers: [
    ChunkingService,
    ChunkStoreService,
    OcrService,
    ParsedBlockService,
    EmbeddingService,
    VectorIndexService,
    SearchIndexService,
    ExtractionService,
    GraphBuildService,
    PipelineOrchestrator,
  ],
  controllers: [KnowledgeGraphController],
  exports: [
    PipelineOrchestrator,
    VectorIndexService,
    SearchIndexService,
    GraphBuildService,
    EmbeddingService,
  ],
})
export class PipelineModule {}
