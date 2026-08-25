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
const token = await resolveToken(baseUrl, options);
const concurrency = positiveInteger(options.concurrency ?? 1, '--concurrency');
const maxIterations = positiveInteger(
  options.maxIterations ?? 2,
  '--max-iterations',
);

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
        maxIterations,
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
  maxIterations,
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
  maxIterations,
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
        maxIterations,
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
      maxIterations,
    });
    conversationId = actual.conversationId ?? conversationId;
    if (actual.error) throw new Error(actual.error);

    const assertions = scoreCase(row, actual);
    return {
      id: row.id,
      slice: row.slice,
      question: row.question,
      pass: Object.values(assertions.deterministic).every(Boolean),
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
  maxIterations,
}) {
  const response = await fetch(`${baseUrl}/rag/chat/stream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ message, conversationId, maxIterations }),
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
  const rewrittenChecks = expected.rewritten_contains.map((needle) => ({
    needle,
    matched: normalize(actual.rewritten ?? row.question).includes(
      normalize(needle),
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
    violated: normalizedAnswer.includes(normalize(fact)),
  }));
  const requiredLiteralChecks = row.gold.required_facts.map((fact) => ({
    fact,
    matched: normalizedAnswer.includes(normalize(fact)),
  }));

  const deterministic = {
    intent: actual.intent === expected.intent,
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
    documentRecall: recalledDocuments.length === expectedDocuments.length,
    evidenceRecall:
      recalledEvidenceGroups.length === row.gold.evidence_groups.length,
    noForbiddenLiteral: forbiddenChecks.every((check) => !check.violated),
    answerProduced: actual.answer.trim().length > 0,
  };

  return {
    deterministic,
    detail: {
      rewrittenChecks,
      entityChecks,
      recalledDocuments,
      expectedDocuments,
      recalledEvidenceGroups: recalledEvidenceGroups.length,
      expectedEvidenceGroups: row.gold.evidence_groups.length,
      forbiddenChecks,
      // 生成答案往往使用同义改写，因此字面覆盖率只作为观察值，不参与 PASS/FAIL。
      requiredFactLiteralCoverage: ratio(
        requiredLiteralChecks.filter((check) => check.matched).length,
        requiredLiteralChecks.length,
      ),
      requiredLiteralChecks,
      unanswerableAcknowledged:
        row.gold.answerable !== false ||
        /(未提供|没有提供|无法确认|不能确认|未找到|知识库中没有)/.test(
          actual.answer,
        ),
    },
  };
}

function buildReport({ datasetPath, baseUrl, maxIterations, results }) {
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

  return {
    metadata: {
      createdAt: new Date().toISOString(),
      datasetPath,
      baseUrl,
      maxIterations,
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
  --max-iterations <number> Agent 最大迭代次数，默认 2
  --output <path>           将完整报告写入 JSON 文件
  --keep-conversations      保留本次评估创建的会话
  --help                    显示帮助`);
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s*_`"'“”‘’「」《》]/g, '');
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
