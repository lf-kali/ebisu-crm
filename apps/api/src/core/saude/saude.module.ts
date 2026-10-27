import { Module } from '@nestjs/common';
import { SaudeController } from './saude.controller.js';

@Module({ controllers: [SaudeController] })
export class SaudeModule {}
