import {
  connectPostgresDatabase,
  getPostgresDatabaseName,
} from '../connection';

/**
 * 保存聊天消息对应的粗粒度 LangGraph 执行轨迹。
 * 用法：npx ts-node database/postgres/seeds/009-add-message-workflow.ts
 */
async function main() {
  const connection = await connectPostgresDatabase(getPostgresDatabaseName());

  try {
    await connection.query('BEGIN');
    await connection.query(
      'ALTER TABLE kh_message ADD COLUMN IF NOT EXISTS workflow JSONB',
    );
    await connection.query('COMMIT');
    console.log('消息执行流程字段已就绪');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error('添加消息执行流程字段失败：', error);
  process.exitCode = 1;
});
