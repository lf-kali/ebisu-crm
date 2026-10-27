import { Controller, Get } from '@nestjs/common';

@Controller('saude')
export class SaudeController {
  @Get()
  verificar(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
