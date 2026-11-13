import { MemoryEventRepository } from '../../../support/memory-event-repository';
import { runEventRepositoryContract } from './event-repository.contract';

runEventRepositoryContract('in-memory', async () => new MemoryEventRepository());
