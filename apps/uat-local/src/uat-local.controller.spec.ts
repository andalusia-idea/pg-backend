import { Test, TestingModule } from '@nestjs/testing';
import { UatLocalController } from './uat-local.controller';
import { UatLocalService } from './uat-local.service';

describe('UatLocalController', () => {
  let uatLocalController: UatLocalController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [UatLocalController],
      providers: [UatLocalService],
    }).compile();

    uatLocalController = app.get<UatLocalController>(UatLocalController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(uatLocalController.getHello()).toBe('Hello World!');
    });
  });
});
