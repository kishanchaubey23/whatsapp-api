/**
 * Worker process entry — long-lived:
 *   npm run dev:worker
 * - MessageWorker (wa-blast-jobs)
 * - GlobalRegistryRecheckWorker (registry-recheck) — isolated concurrency
 * - WWBClientFactory Map shared in-process
 */

import { messageWorker } from './MessageWorker.js';
import { globalRegistryRecheckWorker } from './GlobalRegistryRecheckWorker.js';
import { wwbClientFactory } from '../services/WWBClientFactory.js';
import { globalRegistryRecheckService } from '../services/GlobalRegistryRecheckService.js';

async function main() {
  console.log('[worker-entry] starting MessageWorker + RegistryRecheckWorker + WWBClientFactory');
  messageWorker.start();
  globalRegistryRecheckWorker.start();

  const shutdown = async (sig: string) => {
    console.log(`[worker-entry] ${sig} — shutting down`);
    await messageWorker.stop();
    await globalRegistryRecheckWorker.stop();
    await globalRegistryRecheckService.close().catch(() => undefined);
    await wwbClientFactory.destroyAll();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[worker-entry] fatal', err);
  process.exit(1);
});
