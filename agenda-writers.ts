import { Agenda, Job } from 'agenda';
import { RedisBackend } from '@agendajs/redis-backend';
import { Worker as WorkerThread, isMainThread, workerData, parentPort } from 'node:worker_threads';
import makeBarrier from '@strong-roots-capital/barrier';
import { sleep } from 'bun';

interface Options {
  writers: number;
  duration: number;
}

const redisConnectionString = 'redis://localhost:6379';

async function WriterMain(options: Options) {
  if (!parentPort) {
    throw new Error('parentPort is null');
  }
const backend = new RedisBackend({
  connectionString: redisConnectionString,
}); 
  const agenda = new Agenda({
    backend,
  });

  let queued = 0;
  let adding: Promise<Job>[] = [];
  const start = Date.now();
  const chunkSize = 100;

  while (start + options.duration * 1000 > Date.now()) {
    adding.push(agenda.now('benchmark-job', { param1: 'value1', param2: 'value2' }));
    queued++;

    if (adding.length >= chunkSize) {
      await Promise.all(adding);
      adding = [];
    }
    await sleep(1);
  }

  await Promise.all(adding);
  parentPort.postMessage(queued);
  await backend.disconnect();
}

function formatNumber(n: number, seconds: number) {
  const fmt = (x: number) => x.toLocaleString();
  return `${fmt(n)} (${fmt(Math.round(n / seconds))}/s)`;
}

async function main() {
  const commandLineArgs = require('command-line-args');

  const cliOptions = commandLineArgs([
    { name: 'writers', alias: 'w', type: Number, defaultValue: 1 },
    { name: 'duration', alias: 'd', type: Number, defaultValue: 10 },
  ]);

  const options: Options = {
    writers: cliOptions.writers,
    duration: cliOptions.duration,
  };

  console.log("Running writers with options:", options);

  const barrier = makeBarrier(options.writers);
  const writes: number[] = [];

  for (let i = 0; i < options.writers; ++i) {
    const worker = new WorkerThread(__filename, { workerData: { options } });
    worker.on('error', (err) => console.error(`Writer ${i} error:`, err));
    worker.once('message', (value) => {
      writes.push(value);
      barrier();
    });
  }

  await barrier();

  const total = writes.reduce((sum, a) => sum + a, 0);
  console.log(`Total writes: ${formatNumber(total, options.duration)}`);
}

if (isMainThread) {
  main().catch(console.error);
} else {
  WriterMain(workerData.options).catch(console.error);
}
