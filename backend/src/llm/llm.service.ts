import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

export interface ChatModelOptions {
  apiKey?: string;
  modelName?: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  maxRetries?: number;
  useResponsesApi?: boolean;
}

/**
 * LLM 客户端工厂。
 *
 * 统一解析连接配置；调用方仅传各自任务需要的生成参数。ChatOpenAI 本身
 * 带有模型调用状态，因此这里按场景创建实例，而不是让不同配置共享同一实例。
 */
@Injectable()
export class LlmService {
  constructor(private readonly config: ConfigService) { }

  isConfigured(options: Pick<ChatModelOptions, 'apiKey'> = {}): boolean {
    return Boolean(options.apiKey ?? this.getApiKey());
  }

  create(options: ChatModelOptions = {}): ChatOpenAI {
    return new ChatOpenAI({
      apiKey: options.apiKey ?? this.getApiKey(),
      modelName: options.modelName ?? this.getModelName(),
      temperature:
        options.temperature ?? Number(this.config.get('LLM_TEMPERATURE', 0)),
      timeout: options.timeout,
      maxRetries: options.maxRetries,
      useResponsesApi: options.useResponsesApi,
      configuration: {
        baseURL: options.baseURL ?? this.getBaseURL(),
      },
      modelKwargs: {
        thinking: {
          type: 'disabled',
        }
      }
    });
  }

  private getApiKey(): string | undefined {
    return (
      this.config.get<string>('LLM_API_KEY') ??
      this.config.get<string>('OPENAI_API_KEY')
    );
  }

  private getModelName(): string {
    return (
      this.config.get<string>('LLM_MODEL_NAME') ??
      this.config.get<string>('OPENAI_MODEL_NAME') ??
      this.config.get<string>('LLM_MODEL') ??
      'deepseek-chat'
    );
  }

  private getBaseURL(): string | undefined {
    return (
      this.config.get<string>('LLM_BASE_URL') ??
      this.config.get<string>('OPENAI_BASE_URL')
    );
  }
}
