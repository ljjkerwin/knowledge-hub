import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { GeneratedAnswer } from '../types/rag.types';
import { LlmService } from '../../llm/llm.service';

// 评估结果
export interface EvaluationResult {
  relevance: number; // 相关性（0-1）
  completeness: number; // 完整性（0-1）
  confidence: number; // 置信度（0-1）
  needsFollowUp: boolean; // 是否需要追问
  followUpQuestion?: string; // 追问建议
  reasoning: string; // 评估理由
}

// LLM 输出 schema
const evaluationSchema = z.object({
  relevance: z.number().min(0).max(1).describe('答案与问题的相关性，0-1'),
  completeness: z.number().min(0).max(1).describe('答案的完整性，0-1'),
  needsFollowUp: z.boolean().describe('是否需要追问以获得更好答案'),
  followUpQuestion: z
    .string()
    .optional()
    .describe('如果需要追问，建议的追问问题'),
  reasoning: z.string().describe('评估理由'),
});

@Injectable()
export class AnswerEvaluator {
  private readonly logger = new Logger(AnswerEvaluator.name);
  private readonly llm: ChatOpenAI;

  constructor(private readonly llmService: LlmService) {
    this.llm = this.llmService.create({
      temperature: 0.2, // 低温度以获得稳定评估
      maxTokens: 500,
    });
  }

  /**
   * 评估答案质量
   */
  async evaluate(
    question: string,
    answer: GeneratedAnswer,
  ): Promise<EvaluationResult> {
    this.logger.log(`评估答案质量: 问题="${question.substring(0, 50)}..."`);

    try {
      const response = await this.llm.invoke([
        new SystemMessage(this.getSystemPrompt()),
        new HumanMessage(this.buildEvaluationPrompt(question, answer)),
      ]);

      const content = response.content as string;
      const parsed = this.parseResponse(content);
      const validated = evaluationSchema.parse(parsed);

      const result: EvaluationResult = {
        relevance: validated.relevance,
        completeness: validated.completeness,
        confidence: answer.confidence,
        needsFollowUp: validated.needsFollowUp,
        followUpQuestion: validated.followUpQuestion,
        reasoning: validated.reasoning,
      };

      this.logger.log(
        `评估完成: 相关性=${result.relevance}, 完整性=${result.completeness}, 需追问=${result.needsFollowUp}`,
      );

      return result;
    } catch (error) {
      this.logger.error(`评估失败: ${error.message}`);
      // 降级处理：基于简单规则评估
      return this.simpleEvaluate(question, answer);
    }
  }

  /**
   * 判断是否需要追问
   */
  shouldFollowUp(evaluation: EvaluationResult): boolean {
    // 相关性或完整性低于阈值时需要追问
    const threshold = 0.7;
    return (
      evaluation.needsFollowUp ||
      evaluation.relevance < threshold ||
      evaluation.completeness < threshold
    );
  }

  /**
   * 获取系统 prompt
   */
  private getSystemPrompt(): string {
    return `你是一个答案质量评估专家。你的任务是评估 AI 生成的答案质量。

## 评估维度
1. **相关性**（0-1）：答案是否直接回答了用户问题
2. **完整性**（0-1）：答案是否完整，是否遗漏关键信息
3. **是否需要追问**：当前答案是否足够好，或者需要追问以获得更好答案

## 评估标准
- 高分（0.8-1.0）：答案准确、完整、直接回答问题
- 中分（0.5-0.8）：答案基本相关，但可能不够完整
- 低分（0-0.5）：答案偏离问题或严重不完整

## 追问判断
- 答案模糊或不确定时，建议追问
- 问题涉及多个方面但答案只覆盖部分时，建议追问
- 答案质量足够好时，不需要追问

## 输出格式
请严格按照 JSON 格式输出，不要添加任何其他文字。`;
  }

  /**
   * 构建评估 prompt
   */
  private buildEvaluationPrompt(
    question: string,
    answer: GeneratedAnswer,
  ): string {
    const citationsText =
      answer.citations.length > 0
        ? `\n引用来源：${answer.citations.map((c) => `[${c.index}] ${c.documentTitle}`).join(', ')}`
        : '\n无引用来源';

    return `## 用户问题
${question}

## AI 答案
${answer.answer}

## 引用信息
${citationsText}
当前置信度：${answer.confidence}

请评估这个答案的质量。`;
  }

  /**
   * 解析 LLM 响应
   */
  private parseResponse(content: string): any {
    try {
      return JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      const braceMatch = content.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        return JSON.parse(braceMatch[0]);
      }
      throw new Error('无法解析评估结果');
    }
  }

  /**
   * 简单评估（降级方案）
   */
  private simpleEvaluate(
    question: string,
    answer: GeneratedAnswer,
  ): EvaluationResult {
    const hasCitations = answer.citations.length > 0;
    const answerLength = answer.answer.length;
    const isLongEnough = answerLength > 50;

    return {
      relevance: hasCitations ? 0.7 : 0.5,
      completeness: isLongEnough ? 0.6 : 0.4,
      confidence: answer.confidence,
      needsFollowUp: !hasCitations || !isLongEnough,
      followUpQuestion: !hasCitations ? '能否提供更多信息来源？' : undefined,
      reasoning: '基于简单规则评估（LLM 评估失败）',
    };
  }
}
