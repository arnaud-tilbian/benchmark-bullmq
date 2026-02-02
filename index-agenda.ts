import { Agenda, Job } from 'agenda';
import { MongoBackend } from '@agendajs/mongo-backend';
import { Worker as WorkerThread, isMainThread, workerData, parentPort } from 'node:worker_threads';
import makeBarrier from '@strong-roots-capital/barrier';

interface Options {
  writers: number;
  readers: number;
  duration: number;
  concurrency: number;
}

function sleep(seconds: number) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

const mongoConnectionString = 'mongodb://localhost:27018/agenda';


async function WriterMain(options: Options) {
  let queued = 0;

    const agenda = new Agenda({
      backend: new MongoBackend({
        address: mongoConnectionString,
        collection: `agendaJobs`,
      }),
    });
    await agenda.start();

  let barrier = makeBarrier(1);
  if (!parentPort) {
    throw new Error('parentPort is null');
  }

  parentPort.once('message', (msg) => {
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

    if (adding.length > chunkSize) {
      await Promise.all(adding);
      adding = [];
    }
  }

  await Promise.all(adding);

  await agenda.stop();

  parentPort.postMessage(queued);
}

async function ReaderMain(options: Options) {
  let read = 0;
  let isClosing = false;

    const agenda = new Agenda({
      backend: new MongoBackend({
        address: mongoConnectionString,
        collection: `agendaJobs`,
      }),
      // Poll very frequently for benchmark purposes
      processEvery: '50ms',
      defaultConcurrency: options.concurrency,
      maxConcurrency: options.concurrency,
    });

    // Define the job handler
    agenda.define('benchmark-job', async (job: Job) => {
      if (isClosing) {
        // Since we are closing we should not count this job
        // as time has already expired.
        return;
      }
      ++read;
    });

    await agenda.start();


  await sleep(options.duration);

  isClosing = true;

  // Gracefully drain remaining jobs with a timeout
    try {
      await agenda.drain(2000); // 2 second timeout
    } catch (e) {
      // Ignore drain errors
    }
    finally {
      await agenda.stop();
    }


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
    { name: 'duration', alias: 'd', type: Number, defaultValue: 1 },
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
    let worker = new WorkerThread(__filename, { workerData: { type: 'writer', options } });
    writers.push(worker);
    worker.once('message', (value) => {
      barrier();
    });
  }
  await barrier();

  barrier = makeBarrier(options.writers);
  for (let writer of writers) {
    writer.once('message', (value) => {
      writes.push(value);
      barrier();
    });
  }

  for (let writer of writers) {
    writer.postMessage("start");
  }

  await barrier();

  barrier = makeBarrier(options.readers);
  const readers = options.readers;
  console.log(`Initializing ${readers} readers`);
  let reads: number[] = [];
  for (let i = 0; i < readers; ++i) {
    let worker = new WorkerThread(__filename, { workerData: { type: 'reader', options } });
    worker.once('message', (value) => {
      reads.push(value);
      barrier();
    });
  }

  await barrier();

  console.log(`Threads finished`);

  const total_writes = writes.reduce((sum, a) => sum += a, 0);
  console.log(`Total writes: ${PrintNumber(total_writes, options.duration)}`);
  const total_reads = reads.reduce((sum, a) => sum += a, 0);
  console.log(`Total reads: ${PrintNumber(total_reads, options.duration)}`);
}

if (isMainThread) {
  main().catch(console.error);
} else {
  switch (workerData.type) {
    case 'writer':
      WriterMain(workerData.options).catch(console.error);
      break;
    case 'reader':
      ReaderMain(workerData.options).catch(console.error);
      break;
    default:
      throw new Error(`Unknown type ${workerData.type}`);
  }
}
