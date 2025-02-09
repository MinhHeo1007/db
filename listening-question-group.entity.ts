import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from 'typeorm';
import { ListeningEntity } from './listening.entity';
import { ListeningQuestionEntity } from './listening-question.entity';

@Entity('listening_question_groups')
export class ListeningQuestionGroupEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: false })
  title: string;

  @ManyToOne(() => ListeningEntity, (listeningTest) => listeningTest.questionGroups, {
    onDelete: 'CASCADE',
  })
  listeningTest: ListeningEntity;

  @OneToMany(() => ListeningQuestionEntity, (question) => question.group, {
    cascade: true,
  })
  questions: ListeningQuestionEntity[];
}
