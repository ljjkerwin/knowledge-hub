import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { bigintTransformer } from '../../common/transformers/bigint.transformer';

/** 用户状态：0 正常 / 1 禁用 */
export enum UserStatus {
  Active = 0,
  Disabled = 1,
}

/** 用户角色：0 普通用户 / 1 管理员 */
export enum UserRole {
  User = 0,
  Admin = 1,
}

/** 用户（PostgreSQL kh_user） */
@Entity('kh_user')
export class UserEntity {
  /** 雪花 ID */
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id: string;

  /** 用户名（唯一） */
  @Column({ type: 'varchar', unique: true })
  username: string;

  /** 邮箱（唯一） */
  @Column({ type: 'varchar', unique: true })
  email: string;

  /** 密码哈希 */
  @Column({ name: 'password_hash', type: 'varchar' })
  passwordHash: string;

  /** 昵称 */
  @Column({ type: 'varchar', nullable: true })
  nickname?: string | null;

  /** 头像 URL */
  @Column({ type: 'varchar', nullable: true })
  avatar?: string | null;

  /** 手机号 */
  @Column({ type: 'varchar', nullable: true })
  phone?: string | null;

  /** 状态：0 正常 / 1 禁用 */
  @Column({ type: 'smallint', default: UserStatus.Active })
  status: UserStatus;

  /** 角色：0 普通用户 / 1 管理员 */
  @Column({ type: 'smallint', default: UserRole.User })
  role: UserRole;

  /** 最后登录时间 */
  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  lastLoginAt?: Date | null;

  /** 创建时间 */
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  /** 更新时间 */
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  /** 创建人 ID */
  @Column({
    name: 'create_by',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  createBy?: string | null;

  /** 更新人 ID */
  @Column({
    name: 'update_by',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  updateBy?: string | null;

  /** 逻辑删除 */
  @Column({ type: 'boolean', default: false })
  deleted: boolean;
}
