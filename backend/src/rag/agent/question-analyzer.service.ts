import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { LlmService } from '../../llm/llm.service';

// 查询意图枚举
export enum QueryIntent {
  FACTUAL = 'factual', // 事实性问题
  PROCEDURAL = 'procedural', // 流程/操作问题
  COMPARATIVE = 'comparative', // 比较问题
  EXPLANATORY = 'explanatory', // 解释性问题
}

// 改写结果
export interface RewrittenQuery {
  original: string;
  rewritten: string;
  intent: QueryIntent;
  expandedQueries: string[];
}

// LLM 输出 schema
const analysisSchema = z.object({
  rewritten: z.string().describe('改写后的查询，更清晰、更适合检索'),
  intent: z
    .enum(['factual', 'procedural', 'comparative', 'explanatory'])
    .describe('问题意图'),
  expandedQueries: z
    .array(z.string())
    .describe('扩展的查询词列表，用于提高检索召回率'),
});

@Injectable()
export class QuestionAnalyzer {
  private readonly logger = new Logger(QuestionAnalyzer.name);
  private readonly llm: ChatOpenAI;

  constructor(private readonly llmService: LlmService) {
    this.llm = this.llmService.create({
      temperature: 0.3, // 低温度以获得稳定输出
      maxTokens: 500,
    });
  }

  /**
   * 分析问题：改写 + 意图识别 + 查询扩展
   */
  async analyze(question: string): Promise<RewrittenQuery> {
    this.logger.log(`分析问题: ${question}`);

    try {
      const response = await this.llm.invoke([
        new SystemMessage(this.getSystemPrompt()),
        new HumanMessage(`请分析以下用户问题：\n\n${question}`),
      ]);

      const content = response.content as string;

      // 解析 JSON 响应
      const parsed = this.parseResponse(content);
      const validated = analysisSchema.parse(parsed);

      this.logger.log(
        `问题分析完成: 意图=${validated.intent}, 扩展查询=${validated.expandedQueries.length}个`,
      );

      return {
        original: question,
        rewritten: validated.rewritten,
        intent: validated.intent as QueryIntent,
        expandedQueries: validated.expandedQueries,
      };
    } catch (error) {
      this.logger.error(`问题分析失败: ${error.message}`);
      // 降级处理：返回原始问题
      return {
        original: question,
        rewritten: question,
        intent: QueryIntent.FACTUAL,
        expandedQueries: [question],
      };
    }
  }

  /**
   * 获取系统 prompt
   */
  private getSystemPrompt(): string {
    return `你是一个查询分析专家。你的任务是分析用户问题，并提供优化后的查询。

## 任务
1. **改写查询**：将用户问题改写为更清晰、更适合检索的形式
   - 去除口语化表达
   - 补充关键信息
   - 保持原意

2. **识别意图**：判断问题类型
   - factual: 事实性问题（是什么、有哪些）
   - procedural: 流程/操作问题（如何做、步骤）
   - comparative: 比较问题（区别、对比）
   - explanatory: 解释性问题（为什么、原理）

3. **扩展查询**：生成 2-4 个相关的查询词
   - 同义词/近义词
   - 相关概念
   - 上下位概念

## 输出格式
请严格按照 JSON 格式输出，不要添加任何其他文字。`;
  }

  /**
   * 解析 LLM 响应
   */
  private parseResponse(content: string): any {
    try {
      // 尝试直接解析 JSON
      return JSON.parse(content);
    } catch {
      // 尝试提取 JSON 块
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }

      // 尝试提取花括号内容
      const braceMatch = content.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        return JSON.parse(braceMatch[0]);
      }

      throw new Error('无法解析 LLM 响应');
    }
  }
}
