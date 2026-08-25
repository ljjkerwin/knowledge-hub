import 'dotenv/config';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

export const isLangfuseDebugEnabled =
  process.env.LANGFUSE_DEBUG?.toLowerCase() === 'true' ||
  process.env.LANGFUSE_LOG_LEVEL?.toUpperCase() === 'DEBUG';

const credentialsConfigured = Boolean(
  process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
);

export const langfuseSpanProcessor = new LangfuseSpanProcessor({
  // During diagnostics, export each completed span immediately so failures are
  // visible in the same request's logs instead of waiting for a batch flush.
  exportMode: isLangfuseDebugEnabled ? 'immediate' : 'batched',
});

export const telemetrySdk = new NodeSDK({
  spanProcessors: [langfuseSpanProcessor],
});

telemetrySdk.start();

if (!credentialsConfigured) {
  console.warn(
    '[Langfuse] tracing started without LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY; traces will not be exported.',
  );
} else if (isLangfuseDebugEnabled) {
  console.info('[Langfuse] tracing debug logging enabled', {
    baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
    environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? 'default',
  });
}
