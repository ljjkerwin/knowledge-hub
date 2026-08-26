import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

/**
 * 通过真实 HTTP/SSE 聊天接口批量运行 Agentic RAG 黄金评估集。
 *
 * 该脚本只使用 Node.js 内置能力，无需额外依赖。它负责：
 * 1. 登录或使用现成 Token；
 * 2. 按样本调用 /rag/chat/stream；
 * 3. 收集分析、路由、召回、答案、评估和耗时；
 * 4. 计算可确定性判分的指标；
 * 5. 可选写出完整 JSON 报告。
 */

const DEFAULT_DATASET = 'evaluation/datasets/agentic-rag-golden-v1.jsonl';

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const datasetPath = resolve(options.dataset ?? DEFAULT_DATASET);
const rows = await loadDataset(datasetPath);
const selectedRows = rows
  .filter((row) => !options.slice || row.slice === options.slice)
  .slice(0, options.limit ?? rows.length);

if (!selectedRows.length) {
  throw new Error('没有符合条件的评估样本，请检查 --slice 或 --limit。');
}

const baseUrl = (
  options.baseUrl ??
  process.env.EVAL_BASE_URL ??
  'http://localhost:5002'
).replace(/\/$/, '');

// 使用历史报告中的 actual 数据重新执行判分，便于修改黄金集或评分规则后快速验证。
// 旧报告若只包含 200 字预览，证据召回仍会受旧数据限制；完整证据需重新在线运行。
if (options.replay) {
  const previousReport = JSON.parse(
    await readFile(resolve(options.replay), 'utf8'),
  );
  const previousById = new Map(
    previousReport.results.map((result) => [result.id, result]),
  );
  const replayResults = selectedRows.map((row) => {
    const previous = previousById.get(row.id);
    if (!previous?.actual) {
      return {
        id: row.id,
        slice: row.slice,
        pass: false,
        error: 'previous report does not contain actual data for this case',
      };
    }
    const assertions = scoreCase(row, previous.actual);
    return {
      id: row.id,
      slice: row.slice,
      question: row.question,
      pass: Object.values(assertions.gates).every(Boolean),
      latencyMs: previous.latencyMs,
      assertions,
      actual: previous.actual,
    };
  });
  const replayReport = buildReport({
    datasetPath,
    baseUrl: previousReport.metadata?.baseUrl ?? baseUrl,
    results: replayResults,
  });
  replayReport.metadata.replayedFrom = resolve(options.replay);
  printSummary(replayReport.summary);
  if (options.output) {
    const outputPath = resolve(options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(replayReport, null, 2)}\n`,
      'utf8',
    );
    console.log(`report written to ${outputPath}`);
  }
  process.exit(replayReport.summary.failed > 0 ? 1 : 0);
}

const token = await resolveToken(baseUrl, options);
const concurrency = positiveInteger(options.concurrency ?? 1, '--concurrency');

console.log(
  `running ${selectedRows.length} cases: baseUrl=${baseUrl}, concurrency=${concurrency}`,
);

const results = new Array(selectedRows.length);
let nextIndex = 0;

// 多 worker 共享 nextIndex；JavaScript 单线程执行使索引递增保持原子性。
async function worker() {
  while (nextIndex < selectedRows.length) {
    const index = nextIndex++;
    const row = selectedRows[index];
    const prefix = `[${index + 1}/${selectedRows.length}] ${row.id}`;
    try {
      const result = await runCase({
        row,
        baseUrl,
        token,
        keepConversations: options.keepConversations,
      });
      results[index] = result;
      console.log(
        `${prefix} ${result.pass ? 'PASS' : 'FAIL'} ${Math.round(result.latencyMs)}ms`,
      );
    } catch (error) {
      results[index] = {
        id: row.id,
        slice: row.slice,
        pass: false,
        error: error instanceof Error ? error.message : String(error),
      };
      console.error(`${prefix} ERROR ${results[index].error}`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const report = buildReport({
  datasetPath,
  baseUrl,
  results,
});

printSummary(report.summary);

if (options.output) {
  const outputPath = resolve(options.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`report written to ${outputPath}`);
}

// 只要存在请求错误或确定性断言失败，就给 CI 返回非零退出码。
if (report.summary.failed > 0) process.exitCode = 1;

async function runCase({
  row,
  baseUrl,
  token,
  keepConversations,
}) {
  let conversationId;
  const startedAt = performance.now();

  try {
    // 多轮样本无法直接向数据库插入指定 assistant 消息，因此先真实执行历史中的
    // user 轮次，让系统生成并保存对应回答，再发送当前待测问题。
    for (const message of row.history) {
      if (message.role !== 'user') continue;
      const warmup = await streamChat({
        baseUrl,
        token,
        message: message.content,
        conversationId,
      });
      conversationId = warmup.conversationId ?? conversationId;
      if (warmup.error)
        throw new Error(`history warmup failed: ${warmup.error}`);
    }

    const actual = await streamChat({
      baseUrl,
      token,
      message: row.question,
      conversationId,
    });
    conversationId = actual.conversationId ?? conversationId;
    if (actual.error) throw new Error(actual.error);

    const assertions = scoreCase(row, actual);
    return {
      id: row.id,
      slice: row.slice,
      question: row.question,
      // PASS/FAIL 只由任务关键门禁决定；改写措辞、实体词和意图仍作为诊断指标，
      // 但不因同义表达或合理的意图歧义将一条正确任务判失败。
      pass: Object.values(assertions.gates).every(Boolean),
      latencyMs: performance.now() - startedAt,
      assertions,
      actual,
    };
  } finally {
    // 默认删除 Runner 创建的会话，避免批量评估污染用户的会话列表。
    if (conversationId && !keepConversations) {
      await deleteConversation(baseUrl, token, conversationId).catch(
        (error) => {
          console.warn(
            `failed to delete evaluation conversation ${conversationId}: ${error.message}`,
          );
        },
      );
    }
  }
}

async function streamChat({
  baseUrl,
  token,
  message,
  conversationId,
}) {
  const response = await fetch(`${baseUrl}/rag/chat/stream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      message,
      conversationId,
      // 普通聊天只返回片段预览；评估必须拿到完整 chunk 才能计算证据召回。
      evaluationMode: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`chat request failed: HTTP ${response.status} ${body}`);
  }
  if (!response.body) throw new Error('chat response has no body');

  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    for (const block of blocks) parseSseBlock(block, events);
  }
  buffer += decoder.decode();
  if (buffer.trim()) parseSseBlock(buffer, events);

  return collectActual(events);
}

function parseSseBlock(block, events) {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data || data === '[DONE]') return;
  try {
    events.push(JSON.parse(data));
  } catch {
    // 非 JSON SSE 数据与业务事件无关，忽略即可。
  }
}

function collectActual(events) {
  const toolCall = events.find(
    (event) => event.type === 'tool_call' && event.toolName === 'retrieval',
  );
  const retrievalEvents = events.filter(
    (event) => event.type === 'retrieval_result',
  );
  const chunks = deduplicateChunks(
    retrievalEvents.flatMap((event) => event.chunks ?? []),
  );
  const evaluationEvents = events.filter(
    (event) => event.type === 'evaluation',
  );
  const done = [...events].reverse().find((event) => event.type === 'done');
  const metadata = events.find((event) => event.type === 'metadata');
  const error = events.find((event) => event.type === 'error');
  const answer = events
    .filter((event) => event.type === 'text')
    .map((event) => event.content ?? '')
    .join('');

  return {
    conversationId: metadata?.conversationId,
    queryId: done?.queryId,
    intent: toolCall?.args?.intent ?? inferIntentFromThinking(events),
    needsRetrieval: Boolean(toolCall),
    rewritten: toolCall?.args?.query,
    entityTerms: toolCall?.args?.entityTerms ?? [],
    searchType: toolCall?.args?.searchType,
    useKnowledgeGraph: toolCall?.args?.useKnowledgeGraph,
    chunks,
    answer,
    evaluation: evaluationEvents.at(-1),
    totalIterations: done?.totalIterations ?? 0,
    error: error?.message,
  };
}

function inferIntentFromThinking(events) {
  for (const event of events) {
    if (event.type !== 'thinking') continue;
    const match = event.content?.match(/问题意图:\s*([a-z_]+)/i);
    if (match) return match[1];
  }
  return undefined;
}

function deduplicateChunks(chunks) {
  const unique = new Map();
  for (const chunk of chunks) {
    const key = chunk.chunkId ?? `${chunk.documentId}:${chunk.content}`;
    const previous = unique.get(key);
    // 同一 chunk 可能先以 200 字摘要出现、最终又以完整引用出现，保留更长版本。
    if (
      !previous ||
      (chunk.content?.length ?? 0) > (previous.content?.length ?? 0)
    )
      unique.set(key, chunk);
  }
  return [...unique.values()];
}

function scoreCase(row, actual) {
  const expected = row.expected_analysis;
  const expectedStrategy = row.expected_strategy;
  const normalizedAnswer = normalize(actual.answer);
  const expectedDocuments = row.gold.document_titles;
  // 无答案且没有黄金证据的样本允许“零召回后正确拒答”；有黄金证据时仍要求召回。
  const documentsRequired =
    row.gold.answerable || row.gold.evidence_groups.length > 0;
  const recalledDocuments = expectedDocuments.filter((title) =>
    actual.chunks.some((chunk) => sameLooseText(chunk.documentTitle, title)),
  );
  const recalledEvidenceGroups = row.gold.evidence_groups.filter((group) =>
    actual.chunks.some((chunk) =>
      group.every((needle) =>
        normalize(chunk.content).includes(normalize(needle)),
      ),
    ),
  );
  const rewrittenChecks = expected.rewritten_contains.map((requirement) => ({
    requirement,
    matched: matchTextRequirement(
      actual.rewritten ?? row.question,
      requirement,
    ),
  }));
  const entityChecks = expected.entity_terms_any.map((term) => ({
    term,
    matched: actual.entityTerms.some((actualTerm) =>
      sameLooseText(actualTerm, term),
    ),
  }));
  const forbiddenChecks = row.gold.forbidden_facts.map((fact) => ({
    fact,
    violated: containsPositiveAssertion(normalizedAnswer, normalize(fact)),
  }));
  const requiredLiteralChecks = row.gold.required_facts.map((fact) => ({
    fact,
    matched: normalizedAnswer.includes(normalize(fact)),
  }));
  const acceptableIntents = expected.acceptable_intents ?? [expected.intent];
  const unanswerableAcknowledged =
    row.gold.answerable !== false ||
    /(未提供|没有提供|无法确认|不能确认|未找到|知识库中没有|无法回答|资料不足|信息不足)/.test(
      actual.answer,
    );
  const documentRecallPassed =
    !documentsRequired || recalledDocuments.length === expectedDocuments.length;
  const allEvidencePassed =
    recalledEvidenceGroups.length === row.gold.evidence_groups.length;

  const deterministic = {
    intent: acceptableIntents.includes(actual.intent),
    retrievalDecision: actual.needsRetrieval === expected.needs_retrieval,
    rewrittenContains: rewrittenChecks.every((check) => check.matched),
    entityTermAny:
      entityChecks.length === 0 || entityChecks.some((check) => check.matched),
    searchType:
      expectedStrategy === null ||
      actual.searchType === expectedStrategy.search_type,
    knowledgeGraph:
      expectedStrategy === null ||
      actual.useKnowledgeGraph === expectedStrategy.use_knowledge_graph,
    documentRecall: documentRecallPassed,
    allEvidence: allEvidencePassed,
    noForbiddenAssertion: forbiddenChecks.every((check) => !check.violated),
    unanswerableCalibration: unanswerableAcknowledged,
    answerProduced: actual.answer.trim().length > 0,
  };

  const gates = {
    retrievalDecision: deterministic.retrievalDecision,
    searchType: deterministic.searchType,
    knowledgeGraph: deterministic.knowledgeGraph,
    documentRecall: deterministic.documentRecall,
    allEvidence: deterministic.allEvidence,
    noForbiddenAssertion: deterministic.noForbiddenAssertion,
    unanswerableCalibration: deterministic.unanswerableCalibration,
    answerProduced: deterministic.answerProduced,
  };

  return {
    deterministic,
    gates,
    detail: {
      answerable: row.gold.answerable,
      acceptableIntents,
      rewrittenChecks,
      entityChecks,
      recalledDocuments,
      expectedDocuments,
      documentsRequired,
      recalledEvidenceGroups: recalledEvidenceGroups.length,
      expectedEvidenceGroups: row.gold.evidence_groups.length,
      forbiddenChecks,
      // 生成答案往往使用同义改写，因此字面覆盖率只作为观察值，不参与 PASS/FAIL。
      requiredFactLiteralCoverage: ratio(
        requiredLiteralChecks.filter((check) => check.matched).length,
        requiredLiteralChecks.length,
      ),
      recalledRequiredFacts: requiredLiteralChecks.filter(
        (check) => check.matched,
      ).length,
      expectedRequiredFacts: requiredLiteralChecks.length,
      requiredLiteralChecks,
      unanswerableAcknowledged,
    },
  };
}

function buildReport({ datasetPath, baseUrl, results }) {
  const successful = results.filter((result) => !result.error);
  const passed = results.filter((result) => result.pass).length;
  const latencies = successful
    .map((result) => result.latencyMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const assertionNames = [
    ...new Set(
      successful.flatMap((result) =>
        Object.keys(result.assertions?.deterministic ?? {}),
      ),
    ),
  ];
  const assertionRates = Object.fromEntries(
    assertionNames.map((name) => [
      name,
      ratio(
        successful.filter((result) => result.assertions.deterministic[name])
          .length,
        successful.length,
      ),
    ]),
  );
  const evidenceCases = successful.filter(
    (result) => result.assertions.detail.expectedEvidenceGroups > 0,
  );
  const documentCases = successful.filter(
    (result) =>
      result.assertions.detail.documentsRequired &&
      result.assertions.detail.expectedDocuments.length > 0,
  );
  const unanswerableCases = successful.filter(
    (result) => result.assertions.detail.answerable === false,
  );
  const totalForbiddenFacts = sum(
    successful.map((result) => result.assertions.detail.forbiddenChecks.length),
  );
  const violatedForbiddenFacts = sum(
    successful.map(
      (result) =>
        result.assertions.detail.forbiddenChecks.filter(
          (check) => check.violated,
        ).length,
    ),
  );
  const totalRequiredFacts = sum(
    successful.map((result) => result.assertions.detail.expectedRequiredFacts),
  );
  const recalledRequiredFacts = sum(
    successful.map((result) => result.assertions.detail.recalledRequiredFacts),
  );

  const metrics = {
    analysisAndRouting: {
      intentAccuracy: assertionRates.intent,
      retrievalDecisionAccuracy: assertionRates.retrievalDecision,
      conversationRewritePassRate: assertionRates.rewrittenContains,
      entityTermPassRate: assertionRates.entityTermAny,
      strategyAccuracy: assertionRates.searchType,
      knowledgeGraphRoutingAccuracy: assertionRates.knowledgeGraph,
    },
    retrieval: {
      goldDocumentRecall: ratio(
        sum(
          documentCases.map(
            (result) => result.assertions.detail.recalledDocuments.length,
          ),
        ),
        sum(
          documentCases.map(
            (result) => result.assertions.detail.expectedDocuments.length,
          ),
        ),
      ),
      evidenceGroupRecall: ratio(
        sum(
          evidenceCases.map(
            (result) => result.assertions.detail.recalledEvidenceGroups,
          ),
        ),
        sum(
          evidenceCases.map(
            (result) => result.assertions.detail.expectedEvidenceGroups,
          ),
        ),
      ),
      allEvidenceSuccessRate: ratio(
        evidenceCases.filter(
          (result) => result.assertions.deterministic.allEvidence,
        ).length,
        evidenceCases.length,
      ),
    },
    answer: {
      requiredFactLiteralCoverage: ratio(
        recalledRequiredFacts,
        totalRequiredFacts,
      ),
      forbiddenFactViolationRate: ratio(
        violatedForbiddenFacts,
        totalForbiddenFacts,
      ),
      unanswerableCalibration: ratio(
        unanswerableCases.filter(
          (result) => result.assertions.deterministic.unanswerableCalibration,
        ).length,
        unanswerableCases.length,
      ),
      answerProducedRate: assertionRates.answerProduced,
    },
    agentAndEngineering: {
      taskSuccessRate: ratio(passed, results.length),
      followUpIterationRate: ratio(
        successful.filter((result) => result.actual.totalIterations > 1).length,
        successful.length,
      ),
      averageIterations: average(
        successful.map((result) => result.actual.totalIterations),
      ),
      latencyMs: {
        average: average(latencies),
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
      },
    },
  };

  return {
    metadata: {
      createdAt: new Date().toISOString(),
      datasetPath,
      baseUrl,
    },
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: ratio(passed, results.length),
      requestErrors: results.filter((result) => result.error).length,
      latencyMs: {
        average: average(latencies),
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
      },
      assertionRates,
      metrics,
    },
    results,
  };
}

function printSummary(summary) {
  console.log('\n=== Evaluation Summary ===');
  console.log(
    `pass: ${summary.passed}/${summary.total} (${percent(summary.passRate)}), request errors: ${summary.requestErrors}`,
  );
  console.log(
    `latency: avg=${round(summary.latencyMs.average)}ms p50=${round(summary.latencyMs.p50)}ms p95=${round(summary.latencyMs.p95)}ms`,
  );
  for (const [name, rate] of Object.entries(summary.assertionRates))
    console.log(`${name}: ${percent(rate)}`);
  console.log('\n=== Core Metrics ===');
  console.log(
    `goldDocumentRecall: ${percent(summary.metrics.retrieval.goldDocumentRecall)}`,
  );
  console.log(
    `evidenceGroupRecall: ${percent(summary.metrics.retrieval.evidenceGroupRecall)}`,
  );
  console.log(
    `allEvidenceSuccessRate: ${percent(summary.metrics.retrieval.allEvidenceSuccessRate)}`,
  );
  console.log(
    `unanswerableCalibration: ${percent(summary.metrics.answer.unanswerableCalibration)}`,
  );
  console.log(
    `averageIterations: ${summary.metrics.agentAndEngineering.averageIterations.toFixed(2)}`,
  );
}

async function resolveToken(baseUrl, cliOptions) {
  const directToken = cliOptions.token ?? process.env.EVAL_TOKEN;
  if (directToken) return directToken;

  const username = cliOptions.username ?? process.env.EVAL_USERNAME;
  const password = cliOptions.password ?? process.env.EVAL_PASSWORD;
  if (!username || !password) {
    throw new Error(
      '请设置 EVAL_TOKEN，或同时设置 EVAL_USERNAME 和 EVAL_PASSWORD。',
    );
  }

  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new Error(
      `login failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  const body = await response.json();
  if (!body.token) throw new Error('login response does not contain token');
  return body.token;
}

async function deleteConversation(baseUrl, token, conversationId) {
  const response = await fetch(
    `${baseUrl}/rag/conversations/${conversationId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok)
    throw new Error(`HTTP ${response.status} ${await response.text()}`);
}

async function loadDataset(path) {
  const text = await readFile(path, 'utf8');
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`dataset line ${index + 1}: ${error.message}`);
      }
    });
}

function parseArgs(args) {
  const parsed = {};
  const booleanFlags = new Set(['help', 'keep-conversations']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    // pnpm run <script> -- <args> 在部分版本中会保留参数分隔符本身。
    if (arg === '--') continue;
    if (!arg.startsWith('--')) throw new Error(`unknown argument: ${arg}`);
    const key = arg.slice(2);
    if (booleanFlags.has(key)) {
      parsed[toCamelCase(key)] = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--'))
      throw new Error(`missing value for --${key}`);
    parsed[toCamelCase(key)] = value;
    index += 1;
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node evaluation/run-dataset.mjs [options]

Options:
  --dataset <path>          JSONL 数据集路径
  --base-url <url>          后端地址，默认 http://localhost:5002
  --token <jwt>             直接使用 JWT，也可设置 EVAL_TOKEN
  --username <name>         登录用户名，也可设置 EVAL_USERNAME
  --password <password>     登录密码，也可设置 EVAL_PASSWORD
  --slice <name>            只运行指定 slice
  --limit <number>          只运行前 N 条
  --concurrency <number>    并发数，默认 1
  --output <path>           将完整报告写入 JSON 文件
  --replay <report-path>    使用历史报告 actual 数据重新判分，不请求后端
  --keep-conversations      保留本次评估创建的会话
  --help                    显示帮助`);
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    // 与文档解析层保持一致：兼容 PDF 文本提取器产生的 CJK 部首字形。
    .replace(/[⻅⻆⻋⻓⻔⻛⻜]/g, (glyph) =>
      ({
        '⻅': '见',
        '⻆': '角',
        '⻋': '车',
        '⻓': '长',
        '⻔': '门',
        '⻛': '风',
        '⻜': '飞',
      })[glyph],
    )
    .toLocaleLowerCase()
    .replace(/[\s*_`"'“”‘’「」《》]/g, '');
}

/** requirement 为字符串时必须命中；为字符串数组时命中任意一个同义表达即可。 */
function matchTextRequirement(text, requirement) {
  const alternatives = Array.isArray(requirement) ? requirement : [requirement];
  const normalizedText = normalize(text);
  return alternatives.some((item) => normalizedText.includes(normalize(item)));
}

/**
 * 字面禁止事实只在肯定断言中记为违规。
 * “不可以”“是否可以”“无法确认可以”等否定、疑问上下文不应误报。
 */
function containsPositiveAssertion(normalizedAnswer, normalizedFact) {
  if (!normalizedFact) return false;
  let fromIndex = 0;
  while (true) {
    const index = normalizedAnswer.indexOf(normalizedFact, fromIndex);
    if (index < 0) return false;
    const prefix = normalizedAnswer.slice(Math.max(0, index - 12), index);
    if (!/(不|未|无|无法|不能|没有|并非|否认|是否|能否|不可)/.test(prefix))
      return true;
    fromIndex = index + normalizedFact.length;
  }
}

function sameLooseText(left, right) {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function percentile(sortedValues, quantile) {
  if (!sortedValues.length) return 0;
  return sortedValues[Math.ceil(sortedValues.length * quantile) - 1];
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function round(value) {
  return Math.round(value ?? 0);
}
