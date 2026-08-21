import {
  connectPostgresDatabase,
  getPostgresDatabaseName,
} from '../connection';

/**
 * Knowledge Hub PostgreSQL 数据库创建入口。
 *
 * 用法：
 *   POSTGRES_HOST=localhost POSTGRES_PORT=5432 POSTGRES_USER=user \
 *   POSTGRES_PASSWORD=123456 POSTGRES_DB=knowledge_hub \
 *   pnpm db:postgres:create
 *
 * POSTGRES_ADMIN_DB 用于连接到管理库，默认 postgres。执行用户须拥有 CREATEDB 权限。
 * 本脚本只负责创建数据库；表结构由后续表初始化脚本创建。
 */

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function main() {
  const databaseName = getPostgresDatabaseName();
  const adminDatabase = process.env.POSTGRES_ADMIN_DB ?? 'postgres';

  if (!databaseName.trim()) {
    throw new Error('POSTGRES_DB 不能为空。');
  }

  const adminConnection = await connectPostgresDatabase(adminDatabase);

  try {
    const exists = await adminConnection.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS "exists"',
      [databaseName],
    );

    if (exists.rows[0]?.exists) {
      console.log(`数据库已存在：${databaseName}`);
      return;
    }

    await adminConnection.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    console.log(`数据库创建成功：${databaseName}`);
  } finally {
    await adminConnection.end();
  }
}

main().catch((error: unknown) => {
  console.error('PostgreSQL 数据库初始化失败：', error);
  process.exitCode = 1;
});
