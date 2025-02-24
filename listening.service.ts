import { BadRequestException, Injectable,} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
    Get,
    Param,
    UseInterceptors,
    ClassSerializerInterceptor,
    NotFoundException,
  } from '@nestjs/common';
import { FindOptionsWhere, In, Like, Repository } from 'typeorm';
import { ListeningTestEntity } from '../study4/src/entities/listening-test.entity';
import { ListeningEntity } from '../study4/src/entities/listening.entity';
import { ListeningAnswerEntity } from '../study4/src/entities/listening-answer.entity';
import { QuestionGroupEntity } from '../study4/src/entities/listening-question-group.entity';
import { QuestionEntity } from '../study4/src/entities/listening-question.entity';
import { ListeningListDto } from './dto/listening-list.dto';
import { ListeningAnswerQueryDto, SubmitListeningTestAnswerDto } from './dto/listening-answer.dto';

@Injectable()
export class ListeningService {
  constructor(
    @InjectRepository(ListeningTestEntity)
    private listeningTestRepository: Repository<ListeningTestEntity>,
    @InjectRepository(ListeningEntity)
    private listeningRepository: Repository<ListeningEntity>,
    @InjectRepository(QuestionGroupEntity)
    private questionGroupRepository: Repository<QuestionGroupEntity>,
    @InjectRepository(QuestionEntity)
    private questionRepository: Repository<QuestionEntity>,
    @InjectRepository(ListeningAnswerEntity)
    private listeningAnswerRepository: Repository<ListeningAnswerEntity>,
  ) {}

  async getListeningAnswers(query: ListeningAnswerQueryDto): Promise<ListeningAnswerEntity[]> {
    if (query.listeningIds) {
      return this.listeningAnswerRepository.find({
        where: { listeningId: In(query.listeningIds) },
      });
    } else if (query.listeningTestId) {
      const listenings = await this.listeningRepository.find({
        where: { listeningTestId: query.listeningTestId },
        select: ['id'],
      });
      if (!listenings || listenings.length === 0) {
        throw new NotFoundException('No listenings found for the given listening_test_id');
      }
      const listeningIds = listenings.map((l) => l.id);
      return this.listeningAnswerRepository.find({
        where: { listeningId: In(listeningIds) },
      });
    } else {
      return [];
    }
  }

  async getListeningTestList(dto: ListeningListDto) {
    const { page = 1, limit = 10, keyword } = dto;
    const where = keyword ? { title: Like(`%${keyword}%`) } : {};

    const [listenings, total] = await this.listeningTestRepository.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'ASC' },
    });

    return {
      data: listenings,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async submitAnswer(dto: SubmitListeningTestAnswerDto) {
    const { listeningTestId, listeningAnswers } = dto;
    const listeningTest = await this.listeningTestRepository.findOne({
      where: { id: listeningTestId },
      relations: {
        listenings: {
          answers: true,
        },
      },
      select: {
        id: true,
        crawlId: true,
        listenings: {
          id: true,
          crawlId: true,
          answers: true,
        },
      },
    });
    if (!listeningTest) {
      throw new NotFoundException('Listening test not found');
    }
    const resMap: Record<string, any[]> = {};
    for (const lt of listeningTest.listenings) {
      if (!resMap[lt.id]) {
        resMap[lt.id] = [];
      }
      for (const answer of lt.answers) {
        resMap[lt.id].push({
          questionId: answer.questionId,
          number: answer.number,
          answer: answer.answer,
          inputAnswer: [],
          correct: false,
          category: 'NOT DONE',
          explaination: 'NOT DONE',
        });
      }
    }

    for (const listeningAnswer of listeningAnswers) {
      const rightAnswers = listeningTest.listenings.find(
        (l) => l.id === listeningAnswer.listeningId,
      ).answers;

      for (const answer of listeningAnswer.listeningAnswerDetails) {
        const rightAnswer = rightAnswers.find((r) => r.questionId === answer.questionId);
        if (!rightAnswer || !answer.answers.includes(rightAnswer.answer)) {
          continue;
        }
        const index = resMap[listeningAnswer.listeningId].findIndex(
          (r) => r.questionId === rightAnswer.questionId,
        );
        if (index == -1) {
          continue;
        }
        resMap[listeningAnswer.listeningId][index].correct = true;
        resMap[listeningAnswer.listeningId][index].category = 'TRUE FALSE NOT GIVEN';
      }
    }

    const res = [];
    for (const key of Object.keys(resMap)) {
      res.push(...resMap[key]);
    }
    return res;
  }
}
