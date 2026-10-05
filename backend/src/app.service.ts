import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getStatus(): string {
    return 'El sistema está funcionando correctamente.';
  }
}
