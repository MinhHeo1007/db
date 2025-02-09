import { Test, TestingModule } from '@nestjs/testing';
import { Study4Service } from './study4.service';

describe('Study4Service', () => {
  let service: Study4Service;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [Study4Service],
    }).compile();

    service = module.get<Study4Service>(Study4Service);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
