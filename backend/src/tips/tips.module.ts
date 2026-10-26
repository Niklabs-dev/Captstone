import { Module } from '@nestjs/common';
import { StoresModule } from '../stores/stores.module.js';
import { TipsController } from './tips.controller.js';
import { TipsService } from './tips.service.js';

@Module({
  imports: [StoresModule],
  controllers: [TipsController],
  providers: [TipsService],
})
export class TipsModule {}
