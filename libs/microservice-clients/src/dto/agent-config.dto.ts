import { IsNumber } from 'class-validator';

export class CreateAgentDto {
  @IsNumber()
  id: number;
}
