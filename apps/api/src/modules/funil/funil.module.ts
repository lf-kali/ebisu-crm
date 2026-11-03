import { Module } from '@nestjs/common';
import { FunilController } from './funil.controller.js';

@Module({ controllers: [FunilController] })
export class FunilModule {}
