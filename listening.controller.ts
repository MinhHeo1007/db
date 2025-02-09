import {
  Controller,
  Get,
  Query,
  Param,
  UseInterceptors,
  ClassSerializerInterceptor,
  NotFoundException,
} from '@nestjs/common';
import { ListeningService } from '../services/listening.service';
import { ListeningListDto } from '../dto/listening-list.dto';

@Controller('listening')
export class ListeningController {
  constructor(private readonly listeningService: ListeningService) {}

  @Get()
  @UseInterceptors(ClassSerializerInterceptor)
  async getListeningList(@Query() dto: ListeningListDto) {
    return this.listeningService.getListeningTests(dto);
  }

  @Get(':id')
  async getListeningDetail(@Param('id') id: string) {
    const listening = await this.listeningService.getListeningTestById(id);
    if (!listening) throw new NotFoundException('Listening test not found');
    return listening;
  }
}
