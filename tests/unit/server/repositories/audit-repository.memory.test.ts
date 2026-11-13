import { MemoryAuditRepository } from '../../../support/memory-audit-repository';
import { runAuditRepositoryContract } from './audit-repository.contract';

runAuditRepositoryContract('in-memory', async () => new MemoryAuditRepository());
