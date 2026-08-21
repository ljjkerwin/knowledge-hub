import 'dotenv/config';
import { Client, type ClientConfig } from 'pg';

/** PostgreSQL 连接配置，供数据库初始化脚本复用。 */
export function getPostgresConfig(database: string): ClientConfig {
  return {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'user',
    password: process.env.POSTGRES_PASSWORD ?? '123456',
    database,
  };
}

/** 创建并连接到指定 PostgreSQL 数据库。 */
export async function connectPostgresDatabase(database: string) {
  const connection = new Client(getPostgresConfig(database));
  await connection.connect();
  return connection;
}

/** 与后端运行时配置一致的目标数据库名称。 */
export function getPostgresDatabaseName(): string {
  return process.env.POSTGRES_DB ?? 'knowledge_hub';
}

getPostgresDatabaseName()