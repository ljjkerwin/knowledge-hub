import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { LlmModule } from '../llm/llm.module';
import { EmbeddingService } from '../pipeline/embedding.service';
import { AgentOrchestrator } from '../rag/agent/agent-orchestrator.service';
import { DraftAssessmentService } from '../rag/agent/answer-evaluator.service';
import { QuestionAnalyzer } from '../rag/agent/question-analyzer.service';
import { FusionService } from '../rag/fusion.service';
import { GenerationService } from '../rag/generation.service';
import { GraphRetrievalService } from '../rag/graph-retrieval.service';
import { RerankerService } from '../rag/reranker.service';
import { RetrievalService } from '../rag/retrieval.service';
import { EvaluationJudgeService } from './evaluation-judge.service';

/**
 * 离线评估专用依赖图。
 *
 * 只启动 Agent 核心所需的 LLM、Embedding、Elasticsearch 与 Neo4j 依赖，
 * 避免为了评估而连接 HTTP、Postgres、MongoDB、消息队列和对象存储。
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ElasticsearchModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const password = config.get<string>('ELASTICSEARCH_PASSWORD');
        return {
          node: config.get('ELASTICSEARCH_NODE', 'http://localhost:9200'),
          auth: password
            ? {
                username: config.get('ELASTICSEARCH_USERNAME', 'elastic'),
                password,
              }
            : undefined,
        };
      },
    }),
    LlmModule,
  ],
  providers: [
    EmbeddingService,
    RetrievalService,
    GraphRetrievalService,
    FusionService,
    RerankerService,
    GenerationService,
    QuestionAnalyzer,
    DraftAssessmentService,
    EvaluationJudgeService,
    AgentOrchestrator,
  ],
  exports: [AgentOrchestrator, EvaluationJudgeService],
})
export class EvaluationModule {}
