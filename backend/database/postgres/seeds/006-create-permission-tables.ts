import {
  connectPostgresDatabase,
  getPostgresDatabaseName,
} from '../connection';

/** 初始化权限及角色权限关联表。可安全重复执行。 */
const statements = [
  `CREATE TABLE IF NOT EXISTS kh_permission (
    id BIGINT PRIMARY KEY,
    parent_id BIGINT NOT NULL DEFAULT 0,
    permission_name VARCHAR(50) NOT NULL,
    permission_code VARCHAR(100) NOT NULL UNIQUE,
    permission_type SMALLINT NOT NULL,
    menu_url VARCHAR(200),
    api_url VARCHAR(500),
    method VARCHAR(10),
    icon VARCHAR(50),
    sort INT NOT NULL DEFAULT 0,
    status SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT kh_permission_type_check CHECK (permission_type IN (1, 2, 3)),
    CONSTRAINT kh_permission_status_check CHECK (status IN (0, 1))
  )`,
  `CREATE TABLE IF NOT EXISTS kh_role_permission (
    id BIGINT PRIMARY KEY,
    role_id BIGINT NOT NULL REFERENCES kh_role(id),
    permission_id BIGINT NOT NULL REFERENCES kh_permission(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (role_id, permission_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_kh_role_permission_role_id ON kh_role_permission (role_id)',
  'CREATE INDEX IF NOT EXISTS idx_kh_role_permission_permission_id ON kh_role_permission (permission_id)',
  'CREATE INDEX IF NOT EXISTS idx_kh_permission_code_active ON kh_permission (permission_code) WHERE status = 1 AND deleted = false',
];

const permissions = [
  ['100', '创建文档', 'document:create', '3', '/documents', 'POST'],
  ['101', '更新文档', 'document:update', '3', '/documents/:id', 'PATCH'],
  ['102', '删除文档', 'document:delete', '3', '/documents/:id', 'DELETE'],
  ['103', '发布文档', 'document:publish', '3', '/documents/:id/publish', 'PUT'],
  ['104', '归档文档', 'document:archive', '3', '/documents/:id/archive', 'PUT'],
  [
    '105',
    '提交文档审核',
    'document:submit-review',
    '3',
    '/documents/:id/reviews/submit',
    'POST',
  ],
  [
    '106',
    '审核文档',
    'document:review',
    '3',
    '/documents/reviews/tasks/:taskId',
    'POST',
  ],
] as const;

// 普通用户保留原有文档编辑流程；审核员只获得审核权限；管理员拥有全部初始化权限。
const rolePermissionIds: Array<[string, string]> = [
  ...permissions.map(
    ([permissionId]) => ['1', permissionId] as [string, string],
  ),
  ['2', '106'],
  ['3', '100'],
  ['3', '101'],
  ['3', '102'],
  ['3', '103'],
  ['3', '104'],
  ['3', '105'],
];

async function main() {
  const connection = await connectPostgresDatabase(getPostgresDatabaseName());
  try {
    await connection.query('BEGIN');
    for (const statement of statements) await connection.query(statement);
    for (const [id, name, code, type, apiUrl, method] of permissions) {
      await connection.query(
        `INSERT INTO kh_permission
           (id, permission_name, permission_code, permission_type, api_url, method)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (permission_code) DO NOTHING`,
        [id, name, code, type, apiUrl, method],
      );
    }
    for (const [roleId, permissionId] of rolePermissionIds) {
      // 固定且可重复的关联 ID，避免 seed 依赖额外的序列。
      const id = `${roleId}${permissionId}`;
      await connection.query(
        `INSERT INTO kh_role_permission (id, role_id, permission_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [id, roleId, permissionId],
      );
    }
    await connection.query('COMMIT');
    console.log('权限及角色权限关联表已就绪');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error('权限表初始化失败：', error);
  process.exitCode = 1;
});
