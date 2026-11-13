import { MemoryBlockRepository } from '../../../support/memory-block-repository';
import { runBlockRepositoryContract } from './block-repository.contract';

runBlockRepositoryContract('in-memory', async () => {
  const repo = new MemoryBlockRepository();
  return { repo, auditRows: async () => repo.audit };
});
