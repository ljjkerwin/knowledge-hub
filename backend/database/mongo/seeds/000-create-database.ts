/**
 * Knowledge Hub 数据库初始化入口。
 *
 * 用法：
 *   MONGODB_URI=mongodb://localhost:27017 pnpm db:mongo:create
 *
 * MongoDB 为惰性建库：本脚本通过 connection.ts 建立并验证目标数据库连接；
 * 数据库会在后续集合脚本首次创建集合时真正落库。
 */
import { connectMongoDatabase } from '../connection';

async function main() {
  const { connection, database } = await connectMongoDatabase();

  try {
    await database.command({ ping: 1 });
    console.log(`数据库连接已就绪：${database.databaseName}`);
    console.log('MongoDB 会在首次创建集合时实际创建该数据库。');
  } finally {
    await connection.close();
    process.exit(0);
  }
}

main().catch((error: unknown) => {
  console.error('MongoDB 数据库初始化失败：', error);
  process.exitCode = 1;
});
