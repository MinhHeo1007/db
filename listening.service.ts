import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { ListeningEntity } from '../entities/listening.entity';
import { ListeningListDto } from '../dto/listening-list.dto';

@Injectable()
export class ListeningService {
  constructor(
    @InjectRepository(ListeningEntity)
    private listeningTestRepository: Repository<ListeningEntity>,
  ) {}

  async getListeningTests(dto: ListeningListDto) {
    const { page = 1, limit = 10, keyword } = dto;
    const where = keyword ? { title: Like(`%${keyword}%`) } : {};

    const [tests, total] = await this.listeningTestRepository.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
      select: ['id', 'title', 'originalLink', 'info', 'crawlId'],
    });

    return {
      data: tests,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getListeningTestById(id: string) {
    return this.listeningTestRepository.findOne({
      where: { id },
    });
  }
}
