import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { LangfuseClient } from '@langfuse/client';
import { evaluateCase } from './run-dataset.mjs';

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  assertCredentials();

  // The normal application bootstrap imports this module. This CLI does not,
  // so start it before importing the Nest evaluation module or creating spans.
  const { telemetrySdk } = await import('../dist/src/instrumentation.js');
  const { NestFactory } = await import('@nestjs/core');
  const { EvaluationModule } =
    await import('../dist/src/evaluation/evaluation.module.js');
  const { AgentOrchestrator } =
    await import('../dist/src/rag/agent/agent-orchestrator.service.js');
  const { EvaluationJudgeService } =
    await import('../dist/src/evaluation/evaluation-judge.service.js');

  let langfuse;
  let app;

  try {
    langfuse = new LangfuseClient();
    const dataset = await langfuse.dataset.get(
      encodeURIComponent(args.langfuseDataset),
    );
    const items = selectItems(dataset.items, args);
    if (items.length === 0) {
      throw new Error('No Langfuse dataset items matched the supplied filters');
    }

    const retrievalK = args.retrievalK ?? Number(process.env.RAG_TOP_K ?? 5);
    if (!Number.isInteger(retrievalK) || retrievalK < 1) {
      throw new Error('--retrieval-k must be a positive integer');
    }

    const judgeEnabled =
      args.judge === true ||
      process.env.EVAL_LLM_JUDGE_ENABLED?.trim().toLowerCase() === 'true';
    app = await NestFactory.createApplicationContext(EvaluationModule, {
      logger: ['error', 'warn'],
    });
    const agent = app.get(AgentOrchestrator);
    const judge = judgeEnabled ? app.get(EvaluationJudgeService) : undefined;
    const result = await dataset.runExperiment({
      name: 'knowledge-hub-rag-evaluation',
      runName: args.runName,
      description: 'Offline RAG evaluation using the production agent path.',
      data: items,
      maxConcurrency: args.maxConcurrency,
      metadata: {
        environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? 'local-eval',
        model: process.env.LLM_MODEL_NAME ?? process.env.OPENAI_MODEL_NAME,
        retrievalK,
        llmJudgeEnabled: judgeEnabled,
        gitSha: process.env.GIT_SHA,
      },
      task: async ({ input, metadata }) => {
        assertInput(input, metadata?.sourceCaseId);
        return agent.run({
          question: input.question,
          context: normalizeContext(input, metadata?.sourceCaseId),
          queryId: `langfuse_eval_${metadata?.sourceCaseId ?? Date.now()}`,
          enableFollowUp: input.enableFollowUp ?? true,
        });
      },
      evaluators: [
        async ({ input, output, expectedOutput, metadata }) => {
          assertInput(input, metadata?.sourceCaseId);
          if (!expectedOutput || typeof expectedOutput !== 'object') {
            throw new Error(
              `Dataset item ${metadata?.sourceCaseId ?? 'unknown'} is missing expectedOutput`,
            );
          }
          const evaluation = await evaluateCase(
            { input, expected: expectedOutput },
            output,
            { judge, retrievalK },
          );
          return [
            ...Object.entries(evaluation.checks).map(([name, check]) => ({
              name,
              value: check.value,
              comment: JSON.stringify(check),
            })),
            {
              name: 'case_pass',
              value: Number(evaluation.passed),
              comment: evaluation.passed ? 'PASS' : 'FAIL',
            },
          ];
        },
      ],
      runEvaluators: [
        async ({ itemResults }) => averageEvaluations(itemResults),
      ],
    });
    console.log(await result.format());
  } finally {
    try {
      await app?.close();
    } finally {
      try {
        await langfuse?.shutdown();
      } finally {
        await telemetrySdk.shutdown();
      }
    }
  }
}

function selectItems(items, args) {
  return items.filter((item) => {
    if (args.split && item.metadata?.split !== args.split) return false;
    if (args.case && item.metadata?.sourceCaseId !== args.case) return false;
    return true;
  });
}

function normalizeContext(input, caseId = 'unknown') {
  const context = input.context ?? {};
  return {
    conversationId: `langfuse-eval:${caseId}`,
    history: (context.history ?? []).map((message, index) => ({
      id: `langfuse-eval-message-${index}`,
      conversationId: `langfuse-eval:${caseId}`,
      role: message.role,
      content: message.content,
      createdAt: new Date(0),
    })),
    ...(context.summary ? { summary: context.summary } : {}),
  };
}

function averageEvaluations(itemResults) {
  const valuesByName = new Map();
  for (const item of itemResults) {
    for (const evaluation of item.evaluations) {
      if (typeof evaluation.value !== 'number') continue;
      const values = valuesByName.get(evaluation.name) ?? [];
      values.push(evaluation.value);
      valuesByName.set(evaluation.name, values);
    }
  }
  return [...valuesByName.entries()].map(([name, values]) => ({
    name: `avg_${name}`,
    value: values.reduce((total, value) => total + value, 0) / values.length,
  }));
}

function assertInput(input, caseId) {
  if (!input || typeof input.question !== 'string') {
    throw new Error(`Dataset item ${caseId ?? 'unknown'} is missing input.question`);
  }
}

function assertCredentials() {
  const missing = ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'].filter(
    (name) => !process.env[name],
  );
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function parseArgs(argv) {
  const parsed = { maxConcurrency: 1 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--langfuse-dataset') {
      parsed.langfuseDataset = argv[++index];
    } else if (argument === '--run-name') parsed.runName = argv[++index];
    else if (argument === '--split') parsed.split = argv[++index];
    else if (argument === '--case') parsed.case = argv[++index];
    else if (argument === '--retrieval-k') {
      parsed.retrievalK = Number(argv[++index]);
    } else if (argument === '--max-concurrency') {
      parsed.maxConcurrency = Number(argv[++index]);
    } else if (argument === '--judge') parsed.judge = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!parsed.langfuseDataset) {
    throw new Error('--langfuse-dataset is required');
  }
  if (!Number.isInteger(parsed.maxConcurrency) || parsed.maxConcurrency < 1) {
    throw new Error('--max-concurrency must be a positive integer');
  }
  return parsed;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
