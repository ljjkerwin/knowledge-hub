import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('kh_conversation')
export class ConversationEntity {
  @PrimaryColumn('bigint')
  id: string;

  @Column({ name: 'user_id', type: 'bigint', nullable: true })
  userId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string;

  /** 已压缩的长期对话上下文。 */
  @Column({ name: 'context_summary', type: 'text', nullable: true })
  contextSummary: string | null;

  /** contextSummary 已覆盖到的最后一条消息 ID（Snowflake ID 按时间递增）。 */
  @Column({ name: 'summary_until_message_id', type: 'bigint', nullable: true })
  summaryUntilMessageId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ type: 'boolean', default: false })
  deleted: boolean;
}
