import 'dotenv/config';
import { createConnection } from 'mongoose';

/**
 * 为数据库初始化脚本创建 MongoDB 连接。
 *
 * MONGODB_DB 可覆盖 MONGODB_URI 中的数据库名；未设置时沿用 URI 配置。
 * 连接与数据库选择逻辑集中在此，供各初始化脚本复用。
 */
export async function connectMongoDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error(
      '缺少 MONGODB_URI。示例：mongodb://localhost:27017/knowledge_hub',
    );
  }

  const databaseName = process.env.MONGODB_DB;
  const connection = await createConnection(uri, {
    dbName: databaseName,
  }).asPromise();
  const database = connection.db;

  if (!database) {
    await connection.close();
    throw new Error('MongoDB 连接已建立，但未获取到数据库实例。');
  }

  return { connection, database };
}

connectMongoDatabase()
