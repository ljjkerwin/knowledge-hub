import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RagController } from './rag.controller';
import { RetrievalService } from './retrieval.service';
import { GraphRetrievalService } from './graph-retrieval.service';
import { FusionService } from './fusion.service';
import { GenerationService } from './generation.service';
import { PipelineModule } from '../pipeline/pipeline.module';
import { QuestionAnalyzer } from './agent/question-analyzer.service';
import { StrategySelector } from './agent/strategy-selector.service';
import { AnswerEvaluator } from './agent/answer-evaluator.service';
import { AgentOrchestrator } from './agent/agent-orchestrator.service';
import { ConversationService } from './conversation.service';
import { ContextManager } from './context-manager.service';
import { ConversationEntity } from './entities/conversation.entity';
import { MessageEntity } from './entities/message.entity';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([ConversationEntity, MessageEntity]),
    ElasticsearchModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const password = configService.get('ELASTICSEARCH_PASSWORD');
        return {
          node: configService.get(
            'ELASTICSEARCH_NODE',
            'http://localhost:9200',
          ),
          auth: password
            ? {
                username: configService.get(
                  'ELASTICSEARCH_USERNAME',
                  'elastic',
                ),
                password,
              }
            : undefined,
        };
      },
    }),
    PipelineModule,
    LlmModule,
  ],
  controllers: [RagController],
  providers: [
    RetrievalService,
    GraphRetrievalService,
    FusionService,
    GenerationService,
    QuestionAnalyzer,
    StrategySelector,
    AnswerEvaluator,
    AgentOrchestrator,
    ConversationService,
    ContextManager,
  ],
  exports: [AgentOrchestrator, ConversationService],
})
export class RagModule {}
