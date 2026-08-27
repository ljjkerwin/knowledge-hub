import { hash } from 'bcryptjs';
import {
  connectPostgresDatabase,
  getPostgresDatabaseName,
} from '../connection';

/**
 * 创建开发用户 dev（id=10001）。
 *
 * 依赖：kh_user 表已由 003-create-user-table.ts 创建。
 * 用法：npx ts-node database/postgres/seeds/004-seed-dev-user.ts
 */

const DEV_USER = {
  id: '10001',
  username: 'dev',
  email: 'dev@knowledge-hub.local',
  password: 'ljjkerwin',
  nickname: '开发者',
};

async function main() {
  const databaseName = getPostgresDatabaseName();
  const connection = await connectPostgresDatabase(databaseName);

  try {
    const exists = await connection.query(
      'SELECT 1 FROM kh_user WHERE id = $1 OR username = $2',
      [DEV_USER.id, DEV_USER.username],
    );

    if (exists.rowCount && exists.rowCount > 0) {
      console.log(`开发用户已存在：${DEV_USER.username}（id=${DEV_USER.id}）`);
      return;
    }

    const passwordHash = await hash(DEV_USER.password, 10);

    await connection.query(
      `INSERT INTO kh_user (id, username, email, password_hash, nickname, status, role)
       VALUES ($1, $2, $3, $4, $5, 0, 0)`,
      [
        DEV_USER.id,
        DEV_USER.username,
        DEV_USER.email,
        passwordHash,
        DEV_USER.nickname,
      ],
    );

    console.log(`开发用户创建成功：${DEV_USER.username}（id=${DEV_USER.id}，密码=${DEV_USER.password}）`);
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error('创建开发用户失败：', error);
  process.exitCode = 1;
});
