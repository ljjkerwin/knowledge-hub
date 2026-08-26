import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { Runnable } from '@langchain/core/runnables';
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
  missingAspects: string[]; // 当前答案缺失的具体方面
  followUpQueries: string[]; // 针对缺口生成的检索查询
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
  missingAspects: z
    .array(z.string())
    .max(3)
    .optional()
    .describe('当前答案未覆盖的具体信息点；答案完整时返回空数组'),
  followUpQueries: z
    .array(z.string())
    .max(3)
    .optional()
    .describe('针对缺失信息点生成的独立知识库检索查询；无需补检索时返回空数组'),
  reasoning: z.string().describe('评估理由'),
});

@Injectable()
export class AnswerEvaluator {
  private readonly logger = new Logger(AnswerEvaluator.name);
  private readonly llm: ChatOpenAI;
  private readonly structuredLlm: Runnable<
    BaseLanguageModelInput,
    z.infer<typeof evaluationSchema>
  >;

  constructor(private readonly llmService: LlmService) {
    this.llm = this.llmService.create({
      temperature: 0.2, // 低温度以获得稳定评估
      maxTokens: 500,
    });
    this.structuredLlm = this.llm.withStructuredOutput(evaluationSchema, {
      name: 'evaluate_answer',
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
      const validated = await this.structuredLlm.invoke([
        new SystemMessage(this.getSystemPrompt()),
        new HumanMessage(this.buildEvaluationPrompt(question, answer)),
      ]);

      const result: EvaluationResult = {
        relevance: validated.relevance,
        completeness: validated.completeness,
        confidence: answer.retrievalConfidence,
        needsFollowUp: validated.needsFollowUp,
        followUpQuestion: validated.followUpQuestion,
        missingAspects: validated.missingAspects ?? [],
        followUpQueries: validated.followUpQueries ?? [],
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
- missingAspects 必须指出答案缺少的具体实体、条件、步骤或对比项，不要写“信息不足”等泛化描述
- followUpQueries 必须是可脱离上下文执行的知识库检索语句，直接针对 missingAspects；不要向用户索要信息
- 若答案声称资料中没有某项信息，但用户问题包含多个实体，分别为未覆盖实体生成检索查询

`;
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
检索匹配度：${answer.retrievalConfidence}

请评估这个答案的质量。`;
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
      confidence: answer.retrievalConfidence,
      needsFollowUp: !hasCitations || !isLongEnough,
      followUpQuestion: !hasCitations ? '能否提供更多信息来源？' : undefined,
      missingAspects: !hasCitations ? [question] : [],
      followUpQueries: !hasCitations ? [question] : [],
      reasoning: '基于简单规则评估（LLM 评估失败）',
    };
  }
}
