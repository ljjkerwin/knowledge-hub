import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { ConfigService } from '@nestjs/config';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { RetrievalService } from './retrieval.service';
import { GenerationService } from './generation.service';
import { PipelineModule } from '../pipeline/pipeline.module';

@Module({
  imports: [
    ConfigModule,
    ElasticsearchModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const password = configService.get('ELASTICSEARCH_PASSWORD');
        return {
          node: configService.get('ELASTICSEARCH_NODE', 'http://localhost:9200'),
          auth: password
            ? {
                username: configService.get('ELASTICSEARCH_USERNAME', 'elastic'),
                password,
              }
            : undefined,
        };
      },
    }),
    PipelineModule,
  ],
  controllers: [RagController],
  providers: [RagService, RetrievalService, GenerationService],
  exports: [RagService],
})
export class RagModule {}
