import {
  connectPostgresDatabase,
  getPostgresDatabaseName,
} from '../connection';

/** 初始化多级团队及团队成员表。可重复执行。 */
const statements = [
  `CREATE TABLE IF NOT EXISTS kh_team (
    id BIGINT PRIMARY KEY,
    team_name VARCHAR(100) NOT NULL,
    team_code VARCHAR(50),
    description VARCHAR(500),
    leader_id BIGINT,
    parent_id BIGINT NOT NULL DEFAULT 0,
    sort INT NOT NULL DEFAULT 0,
    status SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT kh_team_status_check CHECK (status IN (0, 1))
  )`,
  'CREATE INDEX IF NOT EXISTS idx_kh_team_parent_id ON kh_team(parent_id)',
  `CREATE TABLE IF NOT EXISTS kh_team_member (
    id BIGINT PRIMARY KEY,
    team_id BIGINT NOT NULL REFERENCES kh_team(id),
    user_id BIGINT NOT NULL REFERENCES kh_user(id),
    member_role VARCHAR(20) NOT NULL DEFAULT 'member',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (team_id, user_id),
    CONSTRAINT kh_team_member_role_check CHECK (member_role IN ('leader', 'member'))
  )`,
  'CREATE INDEX IF NOT EXISTS idx_kh_team_member_user_id ON kh_team_member(user_id)',
  `CREATE TABLE IF NOT EXISTS kh_team_role (
    id BIGINT PRIMARY KEY,
    team_id BIGINT NOT NULL REFERENCES kh_team(id),
    role_id BIGINT NOT NULL REFERENCES kh_role(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (team_id, role_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_kh_team_role_team_id ON kh_team_role(team_id)',
];

async function main() {
  const connection = await connectPostgresDatabase(getPostgresDatabaseName());
  try {
    for (const statement of statements) await connection.query(statement);
    console.log('团队及团队成员表已就绪');
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error('团队表初始化失败：', error);
  process.exitCode = 1;
});
