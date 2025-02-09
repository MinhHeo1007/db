import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { ListeningQuestionGroupEntity } from './listening-question-group.entity';

@Entity('listening_questions')
export class ListeningQuestionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', nullable: false })
  number: number;

  @Column({ type: 'text', nullable: false })
  text: string;

  @Column({ type: 'text', nullable: true })
  answer: string;

  @ManyToOne(() => ListeningQuestionGroupEntity, (group) => group.questions, {
    onDelete: 'CASCADE',
  })
  group: ListeningQuestionGroupEntity;
}
