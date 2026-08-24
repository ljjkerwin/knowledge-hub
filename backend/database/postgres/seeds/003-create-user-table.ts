import {
  connectPostgresDatabase,
  getPostgresDatabaseName,
} from '../connection';

/**
 * Knowledge Hub 用户表结构初始化。
 *
 * 依赖：目标数据库已由 000-create-database.ts 创建。
 * 用法：pnpm db:postgres:seed
 */
const statements = [
  `
    CREATE TABLE IF NOT EXISTS kh_user (
      id BIGINT PRIMARY KEY,
      username VARCHAR NOT NULL UNIQUE,
      email VARCHAR NOT NULL UNIQUE,
      password_hash VARCHAR NOT NULL,
      nickname VARCHAR,
      avatar VARCHAR,
      phone VARCHAR,
      status SMALLINT NOT NULL DEFAULT 0,
      role SMALLINT NOT NULL DEFAULT 0,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      create_by BIGINT,
      update_by BIGINT,
      deleted BOOLEAN NOT NULL DEFAULT FALSE,
      CONSTRAINT kh_user_status_check CHECK (status IN (0, 1)),
      CONSTRAINT kh_user_role_check CHECK (role IN (0, 1))
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_kh_user_username
      ON kh_user (username)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_kh_user_email
      ON kh_user (email)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_kh_user_created_at
      ON kh_user (created_at DESC)
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

    console.log(`用户表结构已就绪：${databaseName}`);
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error('PostgreSQL 用户表结构初始化失败：', error);
  process.exitCode = 1;
});
