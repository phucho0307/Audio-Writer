import { Module } from '@nestjs/common';
import { ReferencesController } from './references.controller';

/** The reading list and the genre craft notes (the "Tham khảo" page). */
@Module({
  controllers: [ReferencesController],
})
export class ReferencesModule {}
