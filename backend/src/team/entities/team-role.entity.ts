import { Column, Entity, PrimaryColumn } from 'typeorm';
import { bigintTransformer } from '../../common/transformers/bigint.transformer';

@Entity('kh_team_role')
export class TeamRoleEntity {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer }) id: string;
  @Column({ name: 'team_id', type: 'bigint', transformer: bigintTransformer }) teamId: string;
  @Column({ name: 'role_id', type: 'bigint', transformer: bigintTransformer }) roleId: string;
}
