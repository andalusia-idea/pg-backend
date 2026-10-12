import { Test, TestingModule } from '@nestjs/testing';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';

describe('SettlementController', () => {
  let settlementController: SettlementController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [SettlementController],
      providers: [SettlementService],
    }).compile();

    settlementController = app.get<SettlementController>(SettlementController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(settlementController.getHello()).toBe('Hello World!');
    });
  });
});
