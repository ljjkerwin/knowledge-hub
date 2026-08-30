import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { Runnable } from '@langchain/core/runnables';
import { z } from 'zod';
import { GeneratedAnswer } from '../types/rag.types';
import { LlmService } from '../../llm/llm.service';

/**
 * 当前草稿的运行时评审结果，仅用于决定是否继续检索。
 * 它不是用户可见的置信度，也不是独立的最终质量评估。
 */
export interface DraftAssessment {
  answerRelevance: number;
  answerCompleteness: number;
  shouldRetrieveMore: boolean;
  followUpQuestion?: string; // 追问建议
  missingAspects: string[]; // 当前答案缺失的具体方面
  followUpQueries: string[]; // 针对缺口生成的检索查询
  reasoning: string; // 评估理由
}

// LLM 输出 schema
const draftAssessmentSchema = z.object({
  answerRelevance: z
    .number()
    .min(0)
    .max(1)
    .describe('当前草稿与问题的相关性，0-1'),
  answerCompleteness: z
    .number()
    .min(0)
    .max(1)
    .describe('当前草稿的完整性，0-1'),
  shouldRetrieveMore: z.boolean().describe('是否值得继续检索以改善当前草稿'),
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
export class DraftAssessmentService {
  private readonly logger = new Logger(DraftAssessmentService.name);
  private readonly llm: ChatOpenAI;
  private readonly structuredLlm: Runnable<
    BaseLanguageModelInput,
    z.infer<typeof draftAssessmentSchema>
  >;

  constructor(private readonly llmService: LlmService) {
    this.llm = this.llmService.create({
      temperature: 0.2, // 低温度以获得稳定评估
      maxTokens: 500,
    });
    this.structuredLlm = this.llm.withStructuredOutput(draftAssessmentSchema, {
      name: 'assess_draft',
    });
  }

  /**
   * 评审当前草稿，决定是否值得继续检索。
   */
  async assessDraft(
    question: string,
    answer: GeneratedAnswer,
  ): Promise<DraftAssessment> {
    this.logger.log(`评审答案草稿: 问题="${question.substring(0, 50)}..."`);

    try {
      const validated = await this.structuredLlm.invoke([
        new SystemMessage(this.getSystemPrompt()),
        new HumanMessage(this.buildEvaluationPrompt(question, answer)),
      ]);

      const result: DraftAssessment = {
        answerRelevance: validated.answerRelevance,
        answerCompleteness: validated.answerCompleteness,
        shouldRetrieveMore: validated.shouldRetrieveMore,
        followUpQuestion: validated.followUpQuestion,
        missingAspects: validated.missingAspects ?? [],
        followUpQueries: validated.followUpQueries ?? [],
        reasoning: validated.reasoning,
      };

      this.logger.log(
        `草稿评审完成: 相关性=${result.answerRelevance}, 完整性=${result.answerCompleteness}, 需继续检索=${result.shouldRetrieveMore}`,
      );

      return result;
    } catch (error) {
      this.logger.error(`草稿评审失败: ${error.message}`);
      // 降级处理：基于简单规则评审
      return this.simpleAssessDraft(question, answer);
    }
  }

  /**
   * 判断当前草稿是否值得继续检索。
   */
  shouldRetrieveMore(assessment: DraftAssessment): boolean {
    // 相关性或完整性低于阈值时值得继续检索。
    const threshold = 0.7;
    return (
      assessment.shouldRetrieveMore ||
      assessment.answerRelevance < threshold ||
      assessment.answerCompleteness < threshold
    );
  }

  /**
   * 获取系统 prompt
   */
  private getSystemPrompt(): string {
    return `你是一个草稿评审助手。你的任务是判断当前 RAG 草稿是否值得继续检索补充。

## 评估维度
1. **相关性**（0-1）：草稿是否直接回答了用户问题，写入 answerRelevance
2. **完整性**（0-1）：草稿是否遗漏关键信息，写入 answerCompleteness
3. **是否继续检索**：当前草稿是否值得继续检索以获得更好答案，写入 shouldRetrieveMore

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

请评审这个草稿。`;
  }

  /**
   * 简单草稿评审（降级方案）
   */
  private simpleAssessDraft(
    question: string,
    answer: GeneratedAnswer,
  ): DraftAssessment {
    const hasCitations = answer.citations.length > 0;
    const answerLength = answer.answer.length;
    const isLongEnough = answerLength > 50;

    return {
      answerRelevance: hasCitations ? 0.7 : 0.5,
      answerCompleteness: isLongEnough ? 0.6 : 0.4,
      shouldRetrieveMore: !hasCitations || !isLongEnough,
      followUpQuestion: !hasCitations ? '能否提供更多信息来源？' : undefined,
      missingAspects: !hasCitations ? [question] : [],
      followUpQueries: !hasCitations ? [question] : [],
      reasoning: '基于简单规则评估（LLM 评估失败）',
    };
  }
}
