/**
 * Langfuse is disabled by default. Set LANGFUSE_TRACING_ENABLED=true to enable
 * all application-side reporting when credentials are configured.
 * This is intentionally evaluated once during application startup.
 */
const tracingExplicitlyEnabled =
  process.env.LANGFUSE_TRACING_ENABLED?.trim().toLowerCase() === 'true';

const credentialsConfigured = Boolean(
  process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
);

export const isLangfuseTracingEnabled =
  tracingExplicitlyEnabled && credentialsConfigured;

export const isLangfuseCredentialsConfigured = credentialsConfigured;
