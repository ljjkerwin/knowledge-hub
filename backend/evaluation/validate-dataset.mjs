import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Agentic RAG 黄金评估集的轻量结构校验脚本。
 *
 * 用法：
 *   node evaluation/validate-dataset.mjs [dataset-path]
 *
 * 不传路径时，默认校验 v1 版 JSONL 数据集。脚本只检查数据结构和
 * 字段间约束，不判断黄金答案、证据内容或检索策略在语义上是否正确。
 */

// 支持从命令行传入其他 JSONL 文件；resolve 同时兼容相对路径和绝对路径。
const datasetPath = resolve(
  process.argv[2] ?? 'evaluation/datasets/agentic-rag-golden-v1.jsonl',
);
const text = await readFile(datasetPath, 'utf8');

// JSONL 每个非空行代表一条样本，忽略文件末尾空行和人为插入的空白行。
const lines = text.split(/\r?\n/).filter((line) => line.trim());
// ids 用于检测样本编号重复；errors 聚合全部问题，方便一次性修复。
const ids = new Set();
const errors = [];

for (const [index, line] of lines.entries()) {
  // 面向使用者输出 1-based 行号，与编辑器显示保持一致。
  const lineNumber = index + 1;
  let row;

  // 单行解析失败时继续检查后续样本，避免只报告第一个 JSON 错误。
  try {
    row = JSON.parse(line);
  } catch (error) {
    errors.push(`line ${lineNumber}: invalid JSON (${error.message})`);
    continue;
  }

  // 检查每条评估样本都必须具备的顶层字段。
  for (const field of [
    'id',
    'slice',
    'question',
    'history',
    'expected_analysis',
    'gold',
    'tags',
  ]) {
    if (!(field in row)) errors.push(`line ${lineNumber}: missing ${field}`);
  }

  // id 会用于结果关联和回归对比，因此必须在整个数据集中保持唯一。
  if (ids.has(row.id))
    errors.push(`line ${lineNumber}: duplicate id ${row.id}`);
  ids.add(row.id);

  // 校验常用集合字段和可回答性标记的基础类型。
  if (!Array.isArray(row.history))
    errors.push(`line ${lineNumber}: history must be an array`);
  if (!Array.isArray(row.tags))
    errors.push(`line ${lineNumber}: tags must be an array`);
  if (typeof row.gold?.answerable !== 'boolean')
    errors.push(`line ${lineNumber}: gold.answerable must be boolean`);

  if (!Array.isArray(row.expected_analysis?.rewritten_contains)) {
    errors.push(
      `line ${lineNumber}: expected_analysis.rewritten_contains must be an array`,
    );
  } else {
    for (const requirement of row.expected_analysis.rewritten_contains) {
      const valid =
        typeof requirement === 'string' ||
        (Array.isArray(requirement) &&
          requirement.length > 0 &&
          requirement.every((item) => typeof item === 'string'));
      if (!valid) {
        errors.push(
          `line ${lineNumber}: rewritten_contains entries must be strings or non-empty string arrays`,
        );
      }
    }
  }

  if (
    row.expected_analysis?.acceptable_intents !== undefined &&
    (!Array.isArray(row.expected_analysis.acceptable_intents) ||
      row.expected_analysis.acceptable_intents.length === 0 ||
      !row.expected_analysis.acceptable_intents.every(
        (intent) => typeof intent === 'string',
      ))
  ) {
    errors.push(
      `line ${lineNumber}: expected_analysis.acceptable_intents must be a non-empty string array`,
    );
  }

  // 黄金文档、证据、必含事实和禁止事实统一使用数组，便于 Runner 逐项判分。
  for (const field of [
    'document_titles',
    'evidence_groups',
    'required_facts',
    'forbidden_facts',
  ]) {
    if (!Array.isArray(row.gold?.[field]))
      errors.push(`line ${lineNumber}: gold.${field} must be an array`);
  }

  if (
    Array.isArray(row.gold?.evidence_groups) &&
    !row.gold.evidence_groups.every(
      (group) =>
        Array.isArray(group) &&
        group.length > 0 &&
        group.every((needle) => typeof needle === 'string'),
    )
  ) {
    errors.push(
      `line ${lineNumber}: gold.evidence_groups entries must be non-empty string arrays`,
    );
  }

  // 检索决策与策略必须一致：直答样本不能配置检索策略，RAG 样本必须配置。
  if (row.expected_analysis?.needs_retrieval === false && row.expected_strategy)
    errors.push(
      `line ${lineNumber}: direct-answer case must not define a retrieval strategy`,
    );
  if (row.expected_analysis?.needs_retrieval === true && !row.expected_strategy)
    errors.push(
      `line ${lineNumber}: retrieval case must define a retrieval strategy`,
    );
}

if (errors.length) {
  // 将所有结构错误一次性输出，并用非零退出码供 CI 判断校验失败。
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  // 校验通过后输出各能力切片的样本量，便于检查数据分布是否失衡。
  const slices = new Map();
  for (const line of lines) {
    const { slice } = JSON.parse(line);
    slices.set(slice, (slices.get(slice) ?? 0) + 1);
  }
  console.log(`validated ${lines.length} cases from ${datasetPath}`);
  console.log(
    [...slices.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => `${name}: ${count}`)
      .join('\n'),
  );
}
