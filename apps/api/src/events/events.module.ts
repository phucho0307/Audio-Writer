import { Global, Module } from '@nestjs/common';
import { DomainEvents } from './domain-events';

/**
 * Global because both ends of every event are already deep in other modules,
 * and threading an import through them would recreate the coupling the events
 * exist to avoid.
 */
@Global()
@Module({
  providers: [DomainEvents],
  exports: [DomainEvents],
})
export class EventsModule {}
