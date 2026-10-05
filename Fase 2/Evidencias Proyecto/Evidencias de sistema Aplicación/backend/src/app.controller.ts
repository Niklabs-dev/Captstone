import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';
import { Public } from './auth/decorators/public.decorator.js';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Público: es el healthcheck de docker compose.
  @Public()
  @Get()
  @ApiOperation({ summary: 'Verifica que el servicio esté operativo' })
  @ApiOkResponse({
    description: 'El servicio responde correctamente.',
    type: String,
  })
  getStatus(): string {
    return this.appService.getStatus();
  }
}
