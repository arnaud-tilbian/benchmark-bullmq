import { Agenda, Job } from 'agenda';
import { MongoBackend } from '@agendajs/mongo-backend';
import { RedisBackend } from '@agendajs/redis-backend';
import { Worker as WorkerThread, isMainThread, workerData, parentPort } from 'node:worker_threads';
import makeBarrier from '@strong-roots-capital/barrier';

interface Options {
  writers: number;
  readers: number;
  duration: number;
  concurrency: number;
}

const mongoConnectionString = 'mongodb://localhost:27018/agenda';
const redisConnectionString = 'redis://localhost:6379';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function WriterMain(options: Options) {
  let queued = 0;

  const agenda = new Agenda({
    backend: new RedisBackend({
      connectionString: redisConnectionString,
    }),
  });
  
  let barrier = makeBarrier(1);
  if (!parentPort) {
    throw new Error('parentPort is null');
  }

  parentPort.once('message', () => {
    barrier();
  });

  parentPort.postMessage('ready');
  await barrier();

  let adding: Promise<Job>[] = [];
  const start = Date.now();

  // Wait in chunks to avoid blocking the event loop
  const chunkSize = 2000;
  while (start + options.duration * 1000 > Date.now()) {
    adding.push(agenda.now('benchmark-job', { param1: 'value1', param2: 'value2' }));
    queued++;

    if (adding.length >= chunkSize) {
      await Promise.all(adding);
      adding = [];
    }
  }

  await Promise.all(adding);

  parentPort.postMessage(queued);
}

async function ReaderMain(options: Options) {
  let read = 0;
  let isClosing = false;

  const agenda = new Agenda({
    backend: new RedisBackend({
      connectionString: redisConnectionString,
    }),
    processEvery: 50, // 50ms
    defaultConcurrency: options.concurrency,
    maxConcurrency: options.concurrency,
    defaultLockLimit:10,
  });

  // Define the job handler
  agenda.define('benchmark-job', async (job: Job) => {
    if (isClosing) {
      return;
    }
    ++read;
  });

	await agenda.start();


  // Run for the specified duration
  await sleep(options.duration * 1000);

  isClosing = true;

  // Give time for in-flight jobs to complete, then stop
  await sleep(500);

  if (!parentPort) {
    throw new Error('parentPort is null');
  }
  parentPort.postMessage(read);
}

function NicifyNumber(n: number) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function PrintNumber(n: number, seconds: number) {
  return `${NicifyNumber(n)} (${NicifyNumber(Math.round(n / seconds))}/s)`;
}

async function main() {
  const commandLineArgs = require('command-line-args');

  const optionDefinitions = [
    { name: 'writers', alias: 'w', type: Number, defaultValue: 1 },
    { name: 'readers', alias: 'r', type: Number, defaultValue: 1 },
    { name: 'duration', alias: 'd', type: Number, defaultValue: 10 },
    { name: 'concurrency', alias: 'c', type: Number, defaultValue: 1 },
  ];
  const cliOptions = commandLineArgs(optionDefinitions);

  const options: Options = {
    writers: cliOptions.writers,
    readers: cliOptions.readers,
    duration: cliOptions.duration,
    concurrency: cliOptions.concurrency,
  };

  console.log("Running with options:", options);

  let barrier = makeBarrier(options.writers);

  console.log(`Initializing ${options.writers} writers`);
  let writes: number[] = [];
  let writers: WorkerThread[] = [];
  
  for (let i = 0; i < options.writers; ++i) {
    const worker = new WorkerThread(__filename, { workerData: { type: 'writer', options } });
    writers.push(worker);
    
    worker.on('error', (err) => {
      console.error(`Writer ${i} error:`, err);
    });
    
    worker.once('message', () => {
      barrier();
    });
  }
  await barrier();

  barrier = makeBarrier(options.writers);
  for (const writer of writers) {
    writer.once('message', (value) => {
      writes.push(value);
      barrier();
    });
  }

  for (const writer of writers) {
    writer.postMessage("start");
  }

  await barrier();

  barrier = makeBarrier(options.readers);
  let reads: number[] = [];

  console.log(`Initializing ${options.readers} readers`);
  for (let i = 0; i < options.readers; ++i) {
    const worker = new WorkerThread(__filename, { workerData: { type: 'reader', options } });
    
    worker.on('error', (err) => {
      console.error(`Reader ${i} error:`, err);
    });
    
    worker.once('message', (value) => {
      reads.push(value);
      barrier();
    });
  }

  await barrier();

  const total_writes = writes.reduce((sum, a) => sum + a, 0);
  console.log(`Total writes: ${PrintNumber(total_writes, options.duration)}`);
  const total_reads = reads.reduce((sum, a) => sum + a, 0);
  console.log(`Total reads: ${PrintNumber(total_reads, options.duration)}`);
}

if (isMainThread) {
  main().catch(console.error);
} else {
  const runWorker = async () => {
    try {
      switch (workerData.type) {
        case 'writer':
          await WriterMain(workerData.options);
          break;
        case 'reader':
          await ReaderMain(workerData.options);
          break;
        default:
          throw new Error(`Unknown type ${workerData.type}`);
      }
    } catch (err) {
      console.error(`Worker error (${workerData.type}):`, err);
      throw err;
    }
  };
  
  runWorker();
}
