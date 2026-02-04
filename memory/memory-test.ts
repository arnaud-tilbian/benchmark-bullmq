import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';

const QUEUE_NAME = 'memory-test';
const JOB_NAME = 'aJobWithAQuiteLongNameSuchInRealLife';
const BATCH_SIZE = 100_000;
const CHUNK_SIZE = 5_000;
const MEMORY_LIMIT_BYTES = 5 * 1024 * 1024 * 1024; // 4 GB

function getJobData() {
  return {
    userId: 'nvD354ssxGayR46K2',
    bankAccountId: 'nvD354ssxGayR46K2',
    bankAuthId: 'nvD354ssxGayR46K2',
    amountInCents: Math.round(Math.random() * 100_000),
    s3Url:
      'scans/nvD354ssxGayR46K2/2024/scans/2024-06-07_08:32:37-a60f3f26-7e16-439a-8c8a-5b80b60f4a16/7C08A0B2-EABE-4704-861A-6F0B03810F21.jpg',
  };
}

async function getRedisMemoryBytes(connection: IORedis): Promise<number> {
  const info = await connection.info('memory');
  const match = info.match(/used_memory:(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

async function addBulkJobs(queue: Queue, count: number): Promise<void> {
  const numChunks = Math.ceil(count / CHUNK_SIZE);
  for (let i = 0; i < numChunks; i++) {
    const jobs = Array.from({ length: CHUNK_SIZE }, () => ({
      name: JOB_NAME,
      data: getJobData(),
    }));
    await queue.addBulk(jobs);
  }
}

async function waitForQueueDrain(queue: Queue): Promise<void> {
  while (true) {
    const waiting = await queue.getWaitingCount();
    if (waiting === 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main() {
  const port = parseInt(process.env.REDIS_PORT ?? '6380', 10);
  const connection = new IORedis({ host: 'localhost', port });
  const workerConnection = new IORedis({ host: 'localhost', port });

  const queue = new Queue(QUEUE_NAME, {
    connection,
    prefix: 'b',
  });

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      /* no-op */
    },
    {
      connection: workerConnection,
      prefix: 'b',
      concurrency: 100,
    }
  );

  console.log('totalJobs,ram_waiting_bytes,ram_completed_bytes,ram_waiting_MB,ram_completed_MB');
  let totalJobs = 0;

  try {
    while (true) {
      // console.log('Adding jobs...');
      await addBulkJobs(queue, BATCH_SIZE);
      totalJobs += BATCH_SIZE;
// console.log('Jobs added !');
      const ramWaiting = await getRedisMemoryBytes(connection);
      const ramWaitingMB = (ramWaiting / 1024 / 1024).toFixed(2);
// console.log('Consuming them...')
      await waitForQueueDrain(queue);
// console.log('JobsConsumed !');
      const ramCompleted = await getRedisMemoryBytes(connection);
      const ramCompletedMB = (ramCompleted / 1024 / 1024).toFixed(2);

      console.log(
        `${totalJobs},${ramWaiting},${ramCompleted},${ramWaitingMB},${ramCompletedMB}`
      );

      if (ramCompleted >= MEMORY_LIMIT_BYTES) {
        console.log(`Reached 5 GB limit at ${totalJobs} jobs`);
        break;
      }
    }
  } finally {
    await worker.close();
    await queue.close();
    connection.disconnect();
    workerConnection.disconnect();
  }
}

main().catch(console.error);
