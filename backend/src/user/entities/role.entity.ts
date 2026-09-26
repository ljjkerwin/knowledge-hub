import { Column, Entity, PrimaryColumn } from 'typeorm';
import { bigintTransformer } from '../../common/transformers/bigint.transformer';

/** 系统角色编码。权限判断必须使用稳定的编码，而非可修改的展示名称。 */
export enum RoleCode {
  Admin = 'ROLE_ADMIN',
  Reviewer = 'ROLE_REVIEWER',
  User = 'ROLE_USER',
}

/** 角色（PostgreSQL kh_role） */
@Entity('kh_role')
export class RoleEntity {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id: string;

  @Column({ name: 'role_name', type: 'varchar', length: 50 })
  roleName: string;

  @Column({ name: 'role_code', type: 'varchar', length: 50, unique: true })
  roleCode: RoleCode;

  @Column({ type: 'varchar', length: 200, nullable: true })
  description?: string | null;

  /** 0 禁用 / 1 启用 */
  @Column({ type: 'smallint', default: 1 })
  status: number;
}
