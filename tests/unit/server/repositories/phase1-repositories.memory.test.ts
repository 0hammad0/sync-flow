import { MemoryFileRepository } from '../../../support/in-memory/memory-file-repository';
import { MemoryCronRunRepository, MemoryUserRepository } from '../../../support/in-memory/memory-misc-repositories';
import { MemoryRoomHistoryRepository } from '../../../support/in-memory/memory-room-history-repository';
import { MemoryRoomRepository } from '../../../support/in-memory/memory-room-repository';
import { runFileRepositoryContract } from './file-repository.contract';
import { runCronRunContract, runRoomHistoryContract } from './history-and-cron.contract';
import { runRoomRepositoryContract } from './room-repository.contract';
import { runUserRepositoryContract } from './user-repository.contract';

runFileRepositoryContract('in-memory', async (seed) => {
  const repo = new MemoryFileRepository();
  for (const s of seed.shares) repo.addShare(s.token, s.doc);
  for (const m of seed.messages) repo.addMessage(m.code, m.id, m.doc);
  return repo;
});

runRoomRepositoryContract('in-memory', async (seed) => {
  const repo = new MemoryRoomRepository();
  for (const r of seed) {
    repo.addRoom(r.code, r.doc);
    for (const m of r.messages) repo.addMessage(r.code, m.id, m.doc);
    for (const p of r.presence) repo.addPresence(r.code, p.id, p.lastSeen);
  }
  return repo;
});

runRoomHistoryContract('in-memory', async () => new MemoryRoomHistoryRepository());
runCronRunContract('in-memory', async () => new MemoryCronRunRepository());

runUserRepositoryContract('in-memory', async (seed) => {
  const repo = new MemoryUserRepository();
  for (const u of seed) repo.addUser(u);
  return repo;
});
