import { Test, TestingModule } from '@nestjs/testing';
import { SettlereconController } from './settlerecon.controller';
import { SettlereconService } from './settlerecon.service';

describe('SettlereconController', () => {
  let settlereconController: SettlereconController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [SettlereconController],
      providers: [SettlereconService],
    }).compile();

    settlereconController = app.get<SettlereconController>(SettlereconController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(settlereconController.getHello()).toBe('Hello World!');
    });
  });
});
