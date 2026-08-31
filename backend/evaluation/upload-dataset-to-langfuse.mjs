import 'dotenv/config';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LangfuseClient } from '@langfuse/client';
import { loadDataset } from './validate-dataset.mjs';

/**
 * 
node evaluation/upload-dataset-to-langfuse.mjs --dataset evaluation/dataset.smoke.jsonl

 */

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const datasetPath = args.dataset ?? 'evaluation/dataset.example.jsonl';
  const { absolutePath, rows } = await loadDataset(datasetPath);
  const datasetName = args.langfuseDataset ?? defaultDatasetName(datasetPath);

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          source: absolutePath,
          langfuseDataset: datasetName,
          cases: rows.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  assertCredentials();
  const langfuse = new LangfuseClient();
  await ensureDataset(langfuse, datasetName, absolutePath);

  for (const [index, testCase] of rows.entries()) {
    await langfuse.dataset.createItem({
      // A deterministic UUID makes the operation an upsert, so it is safe to
      // re-run after cases have been added or updated locally.
      id: stableItemId(datasetName, testCase.id),
      datasetName,
      input: testCase.input,
      expectedOutput: testCase.expected,
      metadata: {
        ...testCase.metadata,
        sourceCaseId: testCase.id,
        sourceFile: basename(absolutePath),
      },
    });
    console.log(`[${index + 1}/${rows.length}] uploaded ${testCase.id}`);
  }

  console.log(
    JSON.stringify(
      {
        uploaded: rows.length,
        source: absolutePath,
        langfuseDataset: datasetName,
      },
      null,
      2,
    ),
  );
}

async function ensureDataset(langfuse, name, sourcePath) {
  try {
    await langfuse.dataset.get(encodeURIComponent(name));
    console.log(`Using existing Langfuse dataset: ${name}`);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await langfuse.api.datasets.create({
      name,
      description: `Imported from ${basename(sourcePath)}`,
      metadata: { sourceFile: basename(sourcePath), format: 'jsonl' },
    });
    console.log(`Created Langfuse dataset: ${name}`);
  }
}

function stableItemId(datasetName, caseId) {
  const hash = createHash('sha256')
    .update(`${datasetName}:${caseId}`)
    .digest('hex');
  const variant = ((Number.parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, '0');
  // Format as RFC 4122 UUID v5; Langfuse accepts caller-provided item IDs.
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(
    13,
    16,
  )}-${variant}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
}

function defaultDatasetName(datasetPath) {
  return basename(datasetPath, '.jsonl');
}

function assertCredentials() {
  const missing = ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'].filter(
    (name) => !process.env[name],
  );
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function isNotFound(error) {
  return error?.status === 404 || error?.statusCode === 404;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--dataset') parsed.dataset = argv[++index];
    else if (argument === '--langfuse-dataset') {
      parsed.langfuseDataset = argv[++index];
    } else if (argument === '--dry-run') parsed.dryRun = true;
    else throw new Error(`Unknown argument: ${argument}`);
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
