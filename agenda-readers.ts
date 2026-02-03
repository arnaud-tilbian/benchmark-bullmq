import { Agenda, Job } from 'agenda';
import { RedisBackend } from '@agendajs/redis-backend';
import { Worker as WorkerThread, isMainThread, workerData, parentPort } from 'node:worker_threads';
import makeBarrier from '@strong-roots-capital/barrier';

interface Options {
  readers: number;
  duration: number;
  concurrency: number;
}

const redisConnectionString = 'redis://localhost:6379';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function ReaderMain(options: Options) {
  if (!parentPort) {
    throw new Error('parentPort is null');
  }

  let read = 0;
  let isClosing = false;
  const backend = new RedisBackend({
    connectionString: redisConnectionString,
  });

  const agenda = new Agenda({
    backend,
    processEvery: 50,
    defaultConcurrency: options.concurrency,
    maxConcurrency: options.concurrency,
    defaultLockLimit: 10,
  });

  agenda.define('benchmark-job', async (job: Job) => {
    if (!isClosing) ++read;
  });

  await agenda.start();
  await sleep(options.duration * 1000);

  isClosing = true;
  await sleep(500); // Let in-flight jobs complete

  parentPort.postMessage(read);
  await agenda.stop();
  await backend.disconnect();
}

function formatNumber(n: number, seconds: number) {
  const fmt = (x: number) => x.toLocaleString();
  return `${fmt(n)} (${fmt(Math.round(n / seconds))}/s)`;
}

async function main() {
  const commandLineArgs = require('command-line-args');

  const cliOptions = commandLineArgs([
    { name: 'readers', alias: 'r', type: Number, defaultValue: 1 },
    { name: 'duration', alias: 'd', type: Number, defaultValue: 10 },
    { name: 'concurrency', alias: 'c', type: Number, defaultValue: 1 },
  ]);

  const options: Options = {
    readers: cliOptions.readers,
    duration: cliOptions.duration,
    concurrency: cliOptions.concurrency,
  };

  console.log("Running readers with options:", options);

  const barrier = makeBarrier(options.readers);
  const reads: number[] = [];

  for (let i = 0; i < options.readers; ++i) {
    const worker = new WorkerThread(__filename, { workerData: { options } });
    worker.on('error', (err) => console.error(`Reader ${i} error:`, err));
    worker.once('message', (value) => {
      reads.push(value);
      barrier();
    });
  }

  await barrier();

  const total = reads.reduce((sum, a) => sum + a, 0);
  console.log(`Total reads: ${formatNumber(total, options.duration)}`);
}

if (isMainThread) {
  main().catch(console.error);
} else {
  ReaderMain(workerData.options).catch(console.error);
}
