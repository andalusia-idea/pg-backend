import { Test, TestingModule } from '@nestjs/testing';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';

describe('ConfigController', () => {
  let configController: ConfigController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [ConfigController],
      providers: [ConfigService],
    }).compile();

    configController = app.get<ConfigController>(ConfigController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(configController.getHello()).toBe('Hello World!');
    });
  });
});
