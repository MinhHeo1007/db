import { Module } from '@nestjs/common';
import { Study4Service } from './study4.service';
import { FileParserService } from './file-parser.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReadingEntity } from './entities/reading.entity';
import { QuestionGroupEntity } from './entities/reading-question-group.entity';
import { QuestionEntity } from './entities/reading-question.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReadingEntity,
      QuestionGroupEntity,
      QuestionEntity,
    ]),
  ],
  providers: [Study4Service, FileParserService],
  exports: [Study4Service, FileParserService],
})
export class Study4Module {}
