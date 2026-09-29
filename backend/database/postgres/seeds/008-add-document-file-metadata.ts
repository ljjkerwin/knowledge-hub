import {
  connectPostgresDatabase,
  getPostgresDatabaseName,
} from '../connection';

/**
 * 为已有文档保留上传原文件元数据，供 AI 回答中的引用卡片展示。
 * 用法：npx ts-node database/postgres/seeds/008-add-document-file-metadata.ts
 */
async function main() {
  const connection = await connectPostgresDatabase(getPostgresDatabaseName());

  try {
    await connection.query('BEGIN');
    await connection.query(
      'ALTER TABLE kh_document ADD COLUMN IF NOT EXISTS original_file_name VARCHAR',
    );
    await connection.query(
      'ALTER TABLE kh_document ADD COLUMN IF NOT EXISTS file_size BIGINT',
    );
    await connection.query('COMMIT');
    console.log('文档文件元数据字段已就绪');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error('添加文档文件元数据字段失败：', error);
  process.exitCode = 1;
});
