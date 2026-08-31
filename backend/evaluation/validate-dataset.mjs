import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ALLOWED_ROUTES = new Set(['direct', 'rag']);
const ALLOWED_SPLITS = new Set(['smoke', 'dev', 'test']);

export async function loadDataset(filePath) {
  const absolutePath = resolve(filePath);
  const text = await readFile(absolutePath, 'utf8');
  const rows = [];
  const errors = [];

  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      errors.push(`line ${index + 1}: invalid JSON (${error.message})`);
      continue;
    }

    validateRow(row, index + 1, errors);
    rows.push(row);
  }

  const duplicateIds = findDuplicates(rows.map((row) => row.id));
  for (const id of duplicateIds) errors.push(`duplicate id: ${id}`);

  if (rows.length === 0) errors.push('dataset contains no cases');
  if (errors.length > 0) {
    throw new Error(
      `Invalid evaluation dataset ${absolutePath}:\n- ${errors.join('\n- ')}`,
    );
  }

  return { absolutePath, rows };
}

function validateRow(row, lineNumber, errors) {
  const at = (message) => errors.push(`line ${lineNumber}: ${message}`);

  if (!isRecord(row)) return at('case must be a JSON object');
  if (!nonEmptyString(row.id)) at('id must be a non-empty string');
  if (!isRecord(row.input)) at('input must be an object');
  if (!nonEmptyString(row.input?.question)) {
    at('input.question must be a non-empty string');
  }
  if (!isRecord(row.expected)) at('expected must be an object');
  if (!ALLOWED_ROUTES.has(row.expected?.route)) {
    at('expected.route must be "direct" or "rag"');
  }

  validateStringArray(
    row.expected?.relevantDocumentIds,
    'expected.relevantDocumentIds',
    at,
  );
  validateStringArray(
    row.expected?.relevantChunkIds,
    'expected.relevantChunkIds',
    at,
  );
  validateStringArray(row.expected?.mustInclude, 'expected.mustInclude', at);
  validateStringArray(
    row.expected?.mustNotInclude,
    'expected.mustNotInclude',
    at,
  );
  validateStringArray(
    row.expected?.noAnswerPhrases,
    'expected.noAnswerPhrases',
    at,
  );
  if (
    row.expected?.referenceAnswer !== undefined &&
    !nonEmptyString(row.expected.referenceAnswer)
  ) {
    at('expected.referenceAnswer must be a non-empty string');
  }

  if (
    row.expected?.mustCite !== undefined &&
    typeof row.expected.mustCite !== 'boolean'
  ) {
    at('expected.mustCite must be a boolean');
  }
  if (
    row.expected?.noAnswer !== undefined &&
    typeof row.expected.noAnswer !== 'boolean'
  ) {
    at('expected.noAnswer must be a boolean');
  }
  if (
    row.expected?.minGroundedness !== undefined &&
    (!Number.isFinite(row.expected.minGroundedness) ||
      row.expected.minGroundedness < 0 ||
      row.expected.minGroundedness > 1)
  ) {
    at('expected.minGroundedness must be a number between 0 and 1');
  }
  if (
    row.expected?.minAnswerRelevancy !== undefined &&
    (!Number.isFinite(row.expected.minAnswerRelevancy) ||
      row.expected.minAnswerRelevancy < 0 ||
      row.expected.minAnswerRelevancy > 1)
  ) {
    at('expected.minAnswerRelevancy must be a number between 0 and 1');
  }
  if (
    row.expected?.maxIterations !== undefined &&
    (!Number.isInteger(row.expected.maxIterations) ||
      row.expected.maxIterations < 1)
  ) {
    at('expected.maxIterations must be a positive integer');
  }
  if (
    row.expected?.maxTotalMs !== undefined &&
    (!Number.isFinite(row.expected.maxTotalMs) || row.expected.maxTotalMs <= 0)
  ) {
    at('expected.maxTotalMs must be a positive number');
  }

  const context = row.input?.context;
  if (context !== undefined) {
    if (!isRecord(context)) at('input.context must be an object');
    if (context?.history !== undefined) {
      if (!Array.isArray(context.history)) {
        at('input.context.history must be an array');
      } else {
        context.history.forEach((message, index) => {
          if (
            !isRecord(message) ||
            !['user', 'assistant'].includes(message.role)
          ) {
            at(
              `input.context.history[${index}].role must be user or assistant`,
            );
          }
          if (!nonEmptyString(message?.content)) {
            at(
              `input.context.history[${index}].content must be a non-empty string`,
            );
          }
        });
      }
    }
  }

  if (!isRecord(row.metadata)) at('metadata must be an object');
  if (!nonEmptyString(row.metadata?.category))
    at('metadata.category is required');
  if (!ALLOWED_SPLITS.has(row.metadata?.split)) {
    at('metadata.split must be smoke, dev, or test');
  }
}

function validateStringArray(value, name, report) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => !nonEmptyString(item))) {
    report(`${name} must be an array of non-empty strings`);
  }
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function main() {
  const datasetPath = process.argv[2] ?? 'evaluation/dataset.example.jsonl';
  const { absolutePath, rows } = await loadDataset(datasetPath);
  const counts = Object.groupBy(rows, (row) => row.metadata.split);
  console.log(
    JSON.stringify(
      {
        valid: true,
        dataset: absolutePath,
        cases: rows.length,
        splits: Object.fromEntries(
          Object.entries(counts).map(([split, items]) => [split, items.length]),
        ),
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
