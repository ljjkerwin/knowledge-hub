import {
  connectPostgresDatabase,
  getPostgresDatabaseName,
} from '../connection';

/**
 * 初始化 RBAC 的角色及用户角色关联表，并将旧 kh_user.role 数据迁移为角色关联。
 * 此脚本可重复执行，不会覆盖已分配的角色。
 */
const statements = [
  `
    CREATE TABLE IF NOT EXISTS kh_role (
      id BIGINT PRIMARY KEY,
      role_name VARCHAR(50) NOT NULL,
      role_code VARCHAR(50) NOT NULL UNIQUE,
      description VARCHAR(200),
      status SMALLINT NOT NULL DEFAULT 1,
      CONSTRAINT kh_role_status_check CHECK (status IN (0, 1))
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS kh_user_role (
      id BIGINT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES kh_user(id),
      role_id BIGINT NOT NULL REFERENCES kh_role(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, role_id)
    )
  `,
  'CREATE INDEX IF NOT EXISTS idx_kh_user_role_user_id ON kh_user_role (user_id)',
  'CREATE INDEX IF NOT EXISTS idx_kh_user_role_role_id ON kh_user_role (role_id)',
];

const roles = [
  ['1', '管理员', 'ROLE_ADMIN', '系统管理与全局访问权限'],
  ['2', '审核员', 'ROLE_REVIEWER', '知识文档审核权限'],
  ['3', '普通用户', 'ROLE_USER', '基础知识库使用权限'],
] as const;

async function main() {
  const databaseName = getPostgresDatabaseName();
  const connection = await connectPostgresDatabase(databaseName);
  try {
    await connection.query('BEGIN');
    try {
      for (const statement of statements) await connection.query(statement);
      for (const [id, name, code, description] of roles) {
        await connection.query(
          `INSERT INTO kh_role (id, role_name, role_code, description)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (role_code) DO NOTHING`,
          [id, name, code, description],
        );
      }
      // 旧字段：0 普通用户 / 1 管理员。仅给尚未分配任何角色的用户补默认角色。
      await connection.query(`
        INSERT INTO kh_user_role (id, user_id, role_id)
        SELECT (1000000000000 + u.id), u.id,
               CASE WHEN u.role = 1 THEN 1 ELSE 3 END
        FROM kh_user u
        WHERE NOT EXISTS (
          SELECT 1 FROM kh_user_role ur WHERE ur.user_id = u.id
        )
        ON CONFLICT (user_id, role_id) DO NOTHING
      `);
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    }
    console.log(`RBAC 表结构及初始角色已就绪：${databaseName}`);
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error('PostgreSQL RBAC 初始化失败：', error);
  process.exitCode = 1;
});
