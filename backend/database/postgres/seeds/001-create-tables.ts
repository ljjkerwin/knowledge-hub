import {
  connectPostgresDatabase,
  getPostgresDatabaseName,
} from '../connection';

/**
 * Knowledge Hub PostgreSQL 第一版表结构初始化。
 *
 * 依赖：目标数据库已由 000-create-database.ts 创建。
 * 用法：pnpm db:postgres:seed
 */
const statements = [
  `
    CREATE TABLE IF NOT EXISTS kh_document (
      id BIGINT PRIMARY KEY,
      title VARCHAR NOT NULL,
      content_id VARCHAR NOT NULL UNIQUE,
      summary VARCHAR,
      category_id BIGINT,
      team_id BIGINT,
      author_id BIGINT,
      cover_image VARCHAR,
      tags VARCHAR,
      status SMALLINT NOT NULL DEFAULT 0,
      remark VARCHAR,
      view_count INTEGER NOT NULL DEFAULT 0,
      like_count INTEGER NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      favourite_count INTEGER NOT NULL DEFAULT 0,
      word_count INTEGER NOT NULL DEFAULT 0,
      publish_time TIMESTAMP,
      is_public BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      create_by BIGINT,
      update_by BIGINT,
      deleted BOOLEAN NOT NULL DEFAULT FALSE,
      CONSTRAINT kh_document_status_check CHECK (status IN (0, 1, 2, 3)),
      CONSTRAINT kh_document_view_count_check CHECK (view_count >= 0),
      CONSTRAINT kh_document_like_count_check CHECK (like_count >= 0),
      CONSTRAINT kh_document_comment_count_check CHECK (comment_count >= 0),
      CONSTRAINT kh_document_favourite_count_check CHECK (favourite_count >= 0),
      CONSTRAINT kh_document_word_count_check CHECK (word_count >= 0)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS kh_document_review (
      id BIGINT PRIMARY KEY,
      document_id BIGINT NOT NULL REFERENCES kh_document (id),
      reviewer_id BIGINT,
      reviewer_name VARCHAR,
      review_result SMALLINT,
      review_comment VARCHAR,
      before_status SMALLINT NOT NULL,
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT kh_document_review_result_check CHECK (review_result IN (1, 2)),
      CONSTRAINT kh_document_review_before_status_check
        CHECK (before_status IN (0, 1, 2, 3)),
      CONSTRAINT kh_document_review_completed_check CHECK (
        (review_result IS NULL AND reviewed_at IS NULL)
        OR (review_result IS NOT NULL AND reviewed_at IS NOT NULL)
      )
    )
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

    console.log(`数据库表结构已就绪：${databaseName}`);
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error('PostgreSQL 表结构初始化失败：', error);
  process.exitCode = 1;
});
