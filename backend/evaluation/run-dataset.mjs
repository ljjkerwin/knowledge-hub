import 'dotenv/config';
import { appendFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDataset } from './validate-dataset.mjs';

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const datasetPath = args.dataset ?? 'evaluation/dataset.example.jsonl';
  const split = args.split;
  const retrievalK = args.retrievalK ?? Number(process.env.RAG_TOP_K ?? 5);
  if (!Number.isInteger(retrievalK) || retrievalK < 1) {
    throw new Error('--retrieval-k must be a positive integer');
  }
  const outputPath = resolve(
    args.output ??
      `evaluation/results/run-${new Date().toISOString().replaceAll(':', '-')}.json`,
  );
  const logPath = resolve(
    args.logFile ??
      (outputPath.endsWith('.json')
        ? outputPath.replace(/\.json$/, '.log')
        : `${outputPath}.log`),
  );
  const { NestFactory } = await import('@nestjs/core');
  const { EvaluationModule } =
    await import('../dist/src/evaluation/evaluation.module.js');
  const { AgentOrchestrator } =
    await import('../dist/src/rag/agent/agent-orchestrator.service.js');
  const { EvaluationJudgeService } =
    await import('../dist/src/evaluation/evaluation-judge.service.js');
  const { absolutePath, rows } = await loadDataset(datasetPath);
  const splitRows = split
    ? rows.filter((row) => row.metadata.split === split)
    : rows;
  if (args.case && args.caseIndex !== undefined) {
    throw new Error('Use either --case or --case-index, not both');
  }
  if (
    args.caseIndex !== undefined &&
    (!Number.isInteger(args.caseIndex) || args.caseIndex < 1)
  ) {
    throw new Error('--case-index must be a positive integer (starting at 1)');
  }
  const selectedRows = args.case
    ? splitRows.filter((row) => row.id === args.case)
    : args.caseIndex !== undefined
      ? [splitRows[args.caseIndex - 1]].filter(Boolean)
      : splitRows;
  if (selectedRows.length === 0)
    throw new Error(
      `No evaluation cases matched${args.case ? ` case=${args.case}` : ''}${
        split ? ` split=${split}` : ''
      }`,
    );
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, '', 'utf8');
  const logger = createRunLogger(logPath);
  logger.log(`Evaluation log: ${logPath}`, 'EvaluationRunner');
  const app = await NestFactory.createApplicationContext(EvaluationModule, {
    logger,
  });
  try {
    const agent = app.get(AgentOrchestrator);
    const judgeEnabled =
      args.judge === true ||
      process.env.EVAL_LLM_JUDGE_ENABLED?.trim().toLowerCase() === 'true';
    const judge = judgeEnabled ? app.get(EvaluationJudgeService) : undefined;
    const caseResults = [];

    for (const [index, testCase] of selectedRows.entries()) {
      logger.log(
        `[${index + 1}/${selectedRows.length}] Starting ${testCase.id}`,
        'EvaluationRunner',
      );
      const result = await agent.run({
        question: testCase.input.question,
        context: normalizeContext(testCase),
        queryId: `eval_${testCase.id}_${Date.now()}`,
        enableFollowUp: testCase.input.enableFollowUp ?? true,
      });
      const evaluation = await evaluateCase(testCase, result, {
        judge,
        retrievalK,
      });
      caseResults.push({ case: testCase, result, evaluation });
      logger.log(
        `[${index + 1}/${selectedRows.length}] ${testCase.id}: ${
          evaluation.passed ? 'PASS' : 'FAIL'
        }`,
        'EvaluationRunner',
      );
    }

    const report = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      dataset: absolutePath,
      split: split ?? 'all',
      configuration: {
        model:
          process.env.LLM_MODEL_NAME ?? process.env.OPENAI_MODEL_NAME ?? null,
        maxIterations: Number(process.env.RAG_MAX_ITERATIONS ?? 3),
        retrievalK,
        llmJudgeEnabled: judgeEnabled,
      },
      summary: summarize(caseResults),
      cases: caseResults,
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    logger.log(JSON.stringify(report.summary), 'EvaluationRunner');
    logger.log(`Report: ${outputPath}`, 'EvaluationRunner');

    if (args.gate && report.summary.passRate < Number(args.gate)) {
      process.exitCode = 2;
    }
  } finally {
    await app.close();
  }
}

function normalizeContext(testCase) {
  const context = testCase.input.context ?? {};
  return {
    conversationId: `eval:${testCase.id}`,
    history: (context.history ?? []).map((message, index) => ({
      id: `eval-message-${index}`,
      conversationId: `eval:${testCase.id}`,
      role: message.role,
      content: message.content,
      createdAt: new Date(0),
    })),
    ...(context.summary ? { summary: context.summary } : {}),
  };
}

export async function evaluateCase(
  testCase,
  result,
  { judge, retrievalK = Number(process.env.RAG_TOP_K ?? 5) } = {},
) {
  const expected = testCase.expected;
  const checks = {
    completed: score(result.completed && !result.error, {
      actual: result.error?.message ?? result.completed,
    }),
    route: score(result.route === expected.route, {
      expected: expected.route,
      actual: result.route,
    }),
  };

  if (expected.mustCite !== undefined) {
    checks.citationRequired = score(
      expected.mustCite
        ? result.citations.length > 0
        : result.citations.length === 0,
      { expected: expected.mustCite, actualCount: result.citations.length },
    );
  }

  if (expected.relevantDocumentIds?.length) {
    const relevant = new Set(expected.relevantDocumentIds);
    const actual = new Set(
      result.citations
        .slice(0, retrievalK)
        .map((citation) => citation.documentId),
    );
    const hits = [...relevant].filter((id) => actual.has(id));
    const relevantCitations = result.citations.filter((citation) =>
      relevant.has(citation.documentId),
    ).length;
    const documentRecallAtK = numericScore(hits.length / relevant.size, {
      k: retrievalK,
      expected: [...relevant],
      actual: [...actual],
    });
    checks.documentRecallAtK = documentRecallAtK;
    // 保留旧字段，避免既有报告消费者中断。
    checks.retrievalRecall = documentRecallAtK;
    checks.citationPrecision = numericScore(
      result.citations.length === 0
        ? 0
        : relevantCitations / result.citations.length,
      { relevantCitations, totalCitations: result.citations.length },
    );
  }

  if (expected.mustInclude?.length) {
    const missing = expected.mustInclude.filter(
      (fact) => !normalize(result.answer).includes(normalize(fact)),
    );
    checks.requiredFacts = numericScore(
      (expected.mustInclude.length - missing.length) /
        expected.mustInclude.length,
      { missing },
    );
  }

  if (expected.mustNotInclude?.length) {
    const violations = expected.mustNotInclude.filter((text) =>
      normalize(result.answer).includes(normalize(text)),
    );
    checks.forbiddenContent = score(violations.length === 0, { violations });
  }

  if (expected.noAnswer === true) {
    const phrases = expected.noAnswerPhrases?.length
      ? expected.noAnswerPhrases
      : ['根据现有资料无法回答'];
    const matchedPhrase = phrases.find((phrase) =>
      normalize(result.answer).includes(normalize(phrase)),
    );
    checks.noAnswerRecognition = score(Boolean(matchedPhrase), {
      expected: true,
      phrases,
      matchedPhrase: matchedPhrase ?? null,
    });
  }

  if (judge && (result.route === 'rag' || expected.noAnswer === true)) {
    const judgment = await judge.evaluate({
      question: testCase.input.question,
      answer: result.answer,
      finalGenerationContext: result.finalGenerationContext,
      expectNoAnswer: expected.noAnswer === true,
    });
    checks.groundedness = judgeScore(
      judgment.groundedness,
      expected.minGroundedness,
      {
        unsupportedClaims: judgment.unsupportedClaims,
        reasoning: judgment.reasoning,
      },
    );
    if (expected.noAnswer === true) {
      checks.noAnswerPhrase = { ...checks.noAnswerRecognition, gate: false };
      checks.noAnswerRecognition = score(judgment.noAnswerRecognized, {
        expected: true,
        reasoning: judgment.reasoning,
      });
    }
  }

  if (expected.maxIterations !== undefined) {
    checks.iterations = score(
      result.totalIterations <= expected.maxIterations,
      {
        expectedMax: expected.maxIterations,
        actual: result.totalIterations,
      },
    );
  }

  if (expected.maxTotalMs !== undefined) {
    checks.latency = score(result.timings.totalMs <= expected.maxTotalMs, {
      expectedMaxMs: expected.maxTotalMs,
      actualMs: result.timings.totalMs,
    });
  }

  return {
    passed: Object.values(checks).every(
      (check) =>
        check.gate === false || check.passed === true || check.value === 1,
    ),
    checks,
  };
}

export function summarize(caseResults) {
  const latencies = caseResults
    .map((item) => item.result.timings.totalMs)
    .sort((a, b) => a - b);
  const firstTextLatencies = caseResults
    .map((item) => item.result.timings.timeToFirstTextMs)
    .filter((value) => value !== undefined)
    .sort((a, b) => a - b);
  const metricValues = new Map();

  for (const item of caseResults) {
    for (const [name, check] of Object.entries(item.evaluation.checks)) {
      const values = metricValues.get(name) ?? [];
      values.push(check.value);
      metricValues.set(name, values);
    }
  }

  const metrics = Object.fromEntries(
    [...metricValues.entries()].map(([name, values]) => [name, mean(values)]),
  );
  const noAnswerValues = caseResults
    .filter((item) => item.case.expected.noAnswer === true)
    .map((item) => item.evaluation.checks.noAnswerRecognition?.value)
    .filter((value) => value !== undefined);
  const metric = (name) => metrics[name] ?? null;
  const metricSamples = (name) => metricValues.get(name)?.length ?? 0;
  const timeToFirstTextMs = summarizeLatency(firstTextLatencies);

  return {
    total: caseResults.length,
    passed: caseResults.filter((item) => item.evaluation.passed).length,
    failed: caseResults.filter((item) => !item.evaluation.passed).length,
    passRate: mean(caseResults.map((item) => Number(item.evaluation.passed))),
    metrics: {
      request_success_rate: metric('completed'),
      route_accuracy: metric('route'),
      document_recall_at_k: metric('documentRecallAtK'),
      required_fact_recall: metric('requiredFacts'),
      groundedness: metric('groundedness'),
      no_answer_accuracy:
        noAnswerValues.length > 0 ? mean(noAnswerValues) : null,
      time_to_first_text_ms: timeToFirstTextMs,
    },
    metric_samples: {
      document_recall_at_k: metricSamples('documentRecallAtK'),
      required_fact_recall: metricSamples('requiredFacts'),
      groundedness: metricSamples('groundedness'),
      no_answer_accuracy: noAnswerValues.length,
    },
    diagnostics: {
      citation_required_rate: metric('citationRequired'),
      citation_precision: metric('citationPrecision'),
      forbidden_content_rate: metric('forbiddenContent'),
      iteration_budget_pass_rate: metric('iterations'),
      latency_budget_pass_rate: metric('latency'),
    },
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.at(-1),
    },
    timeToFirstTextMs,
  };
}

function summarizeLatency(values) {
  if (values.length === 0)
    return { samples: 0, p50: null, p95: null, max: null };
  return {
    samples: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.at(-1),
  };
}

function score(passed, details) {
  return { value: passed ? 1 : 0, ...details };
}

function numericScore(value, details) {
  return { value: Number(value.toFixed(4)), ...details };
}

function judgeScore(value, minimum, details) {
  return {
    value: Number(value.toFixed(4)),
    gate: minimum !== undefined,
    ...(minimum !== undefined ? { minimum, passed: value >= minimum } : {}),
    ...details,
  };
}

function normalize(value) {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function mean(values) {
  return Number(
    (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4),
  );
}

function percentile(sortedValues, quantile) {
  if (sortedValues.length === 0) return null;
  return sortedValues[Math.ceil(sortedValues.length * quantile) - 1];
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--gate') parsed.gate = argv[++index];
    else if (argument === '--dataset') parsed.dataset = argv[++index];
    else if (argument === '--split') parsed.split = argv[++index];
    else if (argument === '--case') parsed.case = argv[++index];
    else if (argument === '--case-index')
      parsed.caseIndex = Number(argv[++index]);
    else if (argument === '--retrieval-k')
      parsed.retrievalK = Number(argv[++index]);
    else if (argument === '--log-file') parsed.logFile = argv[++index];
    else if (argument === '--output') parsed.output = argv[++index];
    else if (argument === '--judge') parsed.judge = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

function createRunLogger(logPath) {
  const write = (level, message, context) => {
    const rendered = typeof message === 'string' ? message : String(message);
    const prefix = `${new Date().toISOString()} ${level.toUpperCase()}${
      context ? ` [${context}]` : ''
    }`;
    const line = `${prefix} ${rendered}\n`;
    appendFileSync(logPath, line, 'utf8');
    const output =
      level === 'error' || level === 'fatal' ? console.error : console.log;
    output(line.trimEnd());
  };
  return {
    log: (message, context) => write('log', message, context),
    error: (message, _trace, context) => write('error', message, context),
    warn: (message, context) => write('warn', message, context),
    debug: (message, context) => write('debug', message, context),
    verbose: (message, context) => write('verbose', message, context),
    fatal: (message, context) => write('fatal', message, context),
  };
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
