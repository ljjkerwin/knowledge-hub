import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DocumentModule } from './document/document.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentEntity } from './document/entities/document.entity';
import { DocumentReviewEntity } from './document/entities/document-review.entity';
import { StorageModule } from './storage/storage.module';
import { MqModule } from './mq/mq.module';
import { PipelineModule } from './pipeline/pipeline.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DocumentModule,
    PipelineModule,
    MqModule,
    StorageModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('POSTGRES_HOST', 'localhost'),
        port: config.get<number>('POSTGRES_PORT', 5432),
        username: config.get<string>('POSTGRES_USER', 'user'),
        password: config.get<string>('POSTGRES_PASSWORD', '123456'),
        database: config.get<string>('POSTGRES_DB', 'knowledge_hub'),
        entities: [DocumentEntity, DocumentReviewEntity],
        synchronize: false,
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),

  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
