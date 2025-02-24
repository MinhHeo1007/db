import {
    Controller,
    Get,
    Query,
    Param,
    UseInterceptors,
    ClassSerializerInterceptor,
    NotFoundException,
    Body,
    Post,
    BadRequestException,
    Injectable,
  } from '@nestjs/common';
  import { InjectRepository } from '@nestjs/typeorm';
  import { Repository, In, Like } from 'typeorm';
  import { ListeningService } from '../src/listening.service';
  import { ListeningListDto } from '../dto/listening-list.dto';
  import { ListeningTestListDto } from '../dto/listening-test.dto';
  import { ListeningAnswerQueryDto, SubmitListeningTestAnswerDto } from '../dto/listening-answer.dto';
  import { ListeningTestEntity } from '../entities/listening-test.entity';
  import { ListeningQuestionGroupEntity } from '../entities/listening-question-group.entity';
  import { ListeningQuestionEntity } from '../entities/listening-question.entity';
  import { ListeningAnswerEntity } from '../entities/listening-answer.entity';
  
  @Injectable()
  @Controller('listening')
  export class ListeningController {
    constructor(
      private readonly listeningService: ListeningService,
      @InjectRepository(ListeningTestEntity)
      private listeningTestRepository: Repository<ListeningTestEntity>,
      @InjectRepository(ListeningQuestionGroupEntity)
      private questionGroupRepository: Repository<ListeningQuestionGroupEntity>,
      @InjectRepository(ListeningQuestionEntity)
      private questionRepository: Repository<ListeningQuestionEntity>,
      @InjectRepository(ListeningAnswerEntity)
      private listeningAnswerRepository: Repository<ListeningAnswerEntity>,
    ) {}
  
    @Get()
    @UseInterceptors(ClassSerializerInterceptor)
    async getListeningList(@Query() dto: ListeningListDto) {
      return this.listeningService.getListeningTests(dto);
    }
  
    @Get('tests')
    async getListeningTestList(@Query() dto: ListeningTestListDto) {
      const { page = 1, limit = 10, keyword } = dto;
      const where = keyword ? { title: Like(`%${keyword}%`) } : {};
  
      const [listeningTests, total] = await this.listeningTestRepository.findAndCount({
        where,
        skip: (page - 1) * limit,
        take: limit,
        order: { createdAt: 'ASC' },
      });
  
      return {
        data: listeningTests,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      };
    }
  
    @Get(':id')
    @UseInterceptors(ClassSerializerInterceptor)
    async getListeningDetail(@Param('id') id: string) {
      const listening = await this.listeningService.getListeningTestById(id);
      if (!listening) throw new NotFoundException('Listening test not found');
      return listening;
    }
  
    @Get(':id/questions')
    @UseInterceptors(ClassSerializerInterceptor)
    async getListeningQuestions(@Param('id') id: string) {
      const questions = await this.listeningService.getListeningQuestions(id);
      if (!questions || questions.length === 0) {
        throw new NotFoundException('No questions found for this listening test');
      }
      return questions;
    }
  
    @Get('answers')
    async getListeningAnswers(@Query() query: ListeningAnswerQueryDto) {
      if (!query.listeningIds && !query.listeningTestId) {
        throw new BadRequestException('Must provide either listening_id or listening_test_id');
      }
      return this.listeningService.getListeningAnswers(query);
    }
  
    @Post('submit')
    async submitAnswer(@Body() dto: SubmitListeningTestAnswerDto) {
      return this.listeningService.submitAnswer(dto);
    }
  }
  
