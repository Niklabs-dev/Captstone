import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './auth/decorators/public.decorator.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Público: es el healthcheck de docker compose.
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
