import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ListeningQuestionGroupEntity } from './listening-question-group.entity';

@Entity('listening_tests')
export class ListeningEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: false })
  title: string;

  @Column({ type: 'text', nullable: false })
  originalLink: string;

  @Column({ type: 'jsonb', nullable: true })
  info: { duration?: string; attempts?: string; comments?: string };

  @Column({ type: 'varchar', nullable: true, length: 50 })
  crawlId: string;

  @Column({ type: 'varchar', nullable: true, length: 50 })
  partId: string;

  @Column({ type: 'text', array: true, nullable: true }) // PostgreSQL
  audioLinks: string[];

  @OneToMany(() => ListeningQuestionGroupEntity, (group) => group.listeningTest, {
    cascade: true,
  })
  questionGroups: ListeningQuestionGroupEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
