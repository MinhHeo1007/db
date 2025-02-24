import {
    Entity,
    Column,
    PrimaryColumn,
    CreateDateColumn,
    UpdateDateColumn,
    JoinColumn,
    ManyToOne,
  } from 'typeorm';
  import { ListeningEntity } from './listening.entity';
  
  @Entity({ name: 'listening_answers' })
  export class ListeningAnswerEntity {
    @PrimaryColumn({
      name: 'id',
      type: 'uuid',
    })
    id: string;
  
    @Column({ name: 'number', type: 'smallint' })
    number: number;
  
    @Column({ name: 'answer', type: 'text', nullable: false })
    answer: any;
  
    @Column({
      name: 'question_id',
      type: 'varchar',
      length: 127,
      nullable: false,
    })
    questionId: string;
  
    @Column({
      name: 'listening_id',
      type: 'uuid',
    })
    listeningId: string;
  
    @ManyToOne(() => ListeningEntity, (listening) => listening.answers, {
      createForeignKeyConstraints: false,
    })
    @JoinColumn({ name: 'listening_id' })
    listening: ListeningEntity;
  
    @CreateDateColumn({
      name: 'created_at',
      type: 'timestamptz',
      default: () => 'CURRENT_TIMESTAMP',
    })
    createdAt: Date;
  
    @UpdateDateColumn({
      name: 'updated_at',
      type: 'timestamptz',
      default: () => 'CURRENT_TIMESTAMP',
      onUpdate: 'CURRENT_TIMESTAMP',
    })
    updatedAt: Date;
  }
  