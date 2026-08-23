import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { RetrievedChunk, Citation, GeneratedAnswer } from './types/rag.types';

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);
  private readonly llm: ChatOpenAI;

  constructor(private readonly config: ConfigService) {
    this.llm = new ChatOpenAI({
      apiKey: this.config.get('LLM_API_KEY'),
      modelName: this.config.get('LLM_MODEL_NAME', 'deepseek-chat'),
      temperature: Number(this.config.get('LLM_TEMPERATURE', 0.7)),
      maxTokens: Number(this.config.get('LLM_MAX_TOKENS', 2000)),
      configuration: {
        baseURL: this.config.get('LLM_BASE_URL'),
      },
    });
  }

  /**
   * 生成答案
   */
  async generate(query: string, context: RetrievedChunk[]): Promise<GeneratedAnswer> {
    try {
      // 1. 构建引用列表
      const citations = this.buildCitations(context);

      // 2. 构建 prompt
      const prompt = this.buildPrompt(query, context, citations);

      // 3. 调用 LLM
      const response = await this.llm.invoke([
        new SystemMessage(this.getSystemPrompt()),
        new HumanMessage(prompt),
      ]);

      // 4. 解析响应
      const answer = response.content as string;
      const confidence = this.calculateConfidence(context, answer);

      this.logger.log(`答案生成完成，置信度: ${confidence}`);
      return { answer, citations, confidence };
    } catch (error) {
      this.logger.error(`答案生成失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 流式生成答案
   */
  async *generateStream(
    query: string,
    context: RetrievedChunk[],
  ): AsyncGenerator<{ type: string; content: any }> {
    try {
      // 1. 构建引用列表
      const citations = this.buildCitations(context);

      // 2. 构建 prompt
      const prompt = this.buildPrompt(query, context, citations);

      // 3. 流式调用 LLM
      const stream = await this.llm.stream([
        new SystemMessage(this.getSystemPrompt()),
        new HumanMessage(prompt),
      ]);

      // 4. 先返回引用信息
      yield { type: 'citations', content: citations };

      // 5. 流式返回 token
      for await (const chunk of stream) {
        if (chunk.content) {
          yield { type: 'token', content: chunk.content };
        }
      }

      // 6. 计算置信度并返回
      const confidence = this.calculateConfidence(context, '');
      yield { type: 'confidence', content: confidence };
    } catch (error) {
      this.logger.error(`流式生成失败: ${error.message}`);
      yield { type: 'error', content: error.message };
    }
  }

  /**
   * 获取系统 prompt
   */
  private getSystemPrompt(): string {
    return `你是一个专业的知识库助手。你的任务是根据提供的参考资料准确回答用户问题。

## 要求
1. **严格基于参考资料**：只使用提供的参考资料回答问题，不要编造或推测信息
2. **标注引用来源**：在答案中使用 [1][2]... 格式标注引用来源
3. **保持准确性**：如果参考资料不足以回答问题，明确说明"根据现有资料无法回答"
4. **结构清晰**：使用清晰的段落和列表组织答案
5. **语言匹配**：使用与用户问题相同的语言回答`;
  }

  /**
   * 构建用户 prompt
   */
  private buildPrompt(query: string, context: RetrievedChunk[], citations: Citation[]): string {
    const contextText = context
      .map((chunk, index) => {
        const citationNum = index + 1;
        const heading = chunk.heading ? ` [${chunk.heading}]` : '';
        return `### 参考资料 [${citationNum}]${heading}
文档：${chunk.documentTitle}
内容：${chunk.content}`;
      })
      .join('\n\n');

    return `## 参考资料
${contextText}

## 用户问题
${query}

## 回答要求
请基于上述参考资料回答问题，并在答案中标注引用来源 [1][2]...`;
  }

  /**
   * 构建引用列表
   */
  private buildCitations(context: RetrievedChunk[]): Citation[] {
    return context.map((chunk, index) => ({
      index: index + 1,
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle,
      chunkContent: chunk.content.substring(0, 200) + (chunk.content.length > 200 ? '...' : ''),
      heading: chunk.heading,
      similarity: chunk.similarity,
    }));
  }

  /**
   * 计算置信度
   */
  private calculateConfidence(context: RetrievedChunk[], answer: string): number {
    if (context.length === 0) return 0;

    // 基于检索结果的相似度计算基础置信度
    const avgSimilarity = context.reduce((sum, chunk) => sum + chunk.similarity, 0) / context.length;

    // 根据结果数量调整（结果越多越自信）
    const resultCountFactor = Math.min(context.length / 3, 1);

    // 根据最高相似度调整
    const maxSimilarity = Math.max(...context.map(c => c.similarity));
    const maxSimilarityFactor = maxSimilarity > 0.8 ? 1 : maxSimilarity > 0.6 ? 0.8 : 0.6;

    // 综合计算
    const confidence = avgSimilarity * 0.4 + resultCountFactor * 0.3 + maxSimilarityFactor * 0.3;

    return Math.round(confidence * 100) / 100;
  }
}
