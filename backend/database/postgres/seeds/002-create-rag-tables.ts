import {
  connectPostgresDatabase,
  getPostgresDatabaseName,
} from '../connection';

/**
 * Knowledge Hub RAG 多轮对话表结构初始化。
 *
 * 依赖：目标数据库已由 000-create-database.ts 创建，基础表已由 001-create-tables.ts 创建。
 * 用法：pnpm db:postgres:seed
 */
const statements = [
  `
    CREATE TABLE IF NOT EXISTS kh_conversation (
      id BIGINT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      title VARCHAR,
      context_summary TEXT,
      summary_until_message_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted BOOLEAN NOT NULL DEFAULT FALSE
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_kh_conversation_user_id
      ON kh_conversation (user_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_kh_conversation_created_at
      ON kh_conversation (created_at DESC)
  `,
  `
    CREATE TABLE IF NOT EXISTS kh_message (
      id BIGINT PRIMARY KEY,
      conversation_id BIGINT NOT NULL REFERENCES kh_conversation (id),
      role VARCHAR NOT NULL,
      content TEXT NOT NULL,
      citations JSONB,
      query_id VARCHAR,
      confidence DECIMAL(3, 2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT kh_message_role_check CHECK (role IN ('user', 'assistant', 'system')),
      CONSTRAINT kh_message_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_kh_message_conversation_id
      ON kh_message (conversation_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_kh_message_created_at
      ON kh_message (created_at)
  `,
];

async function main() {
  const databaseName = getPostgresDatabaseName();
  const connection = await connectPostgresDatabase(databaseName);

  try {
    await connection.query('BEGIN');

    try {
      for (const statement of statements) {
        await connection.query(statement);
      }
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    }

    console.log(`RAG 多轮对话表结构已就绪：${databaseName}`);
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error('PostgreSQL RAG 表结构初始化失败：', error);
  process.exitCode = 1;
});
