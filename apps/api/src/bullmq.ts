/* eslint-disable @typescript-eslint/no-empty-object-type */
import {
  JobsOptions,
  Queue,
  Worker,
  QueueEvents,
  Processor,
  WorkerOptions,
  QueueOptions,
} from "bullmq";
import { Cluster, Redis } from "ioredis";
import { connection } from "./redis";
import { internalEventEmitter } from "./app";

interface BullOptions {
  connection: Redis | Cluster;
  defaultJobOptions: JobsOptions;
}

export interface QueueConfig {}

interface BullBuilder {
  build<
    QueueName extends keyof QueueConfig,
    JobData = QueueConfig[QueueName]["data"],
    JobResult = QueueConfig[QueueName]["result"],
  >(
    name: QueueName,
    queueOptions?: Partial<QueueOptions>,
  ): {
    events: QueueEvents;
    queue: Queue<JobData, JobResult, QueueName>;
    worker: {
      run(
        processor: Processor<JobData>,
        workerOptions?: WorkerOptions,
      ): Worker<JobData, JobResult>;
    };
  };
}

function bull({
  defaultJobOptions,
}: Omit<BullOptions, "connection">): BullBuilder {
  const workers: Worker[] = [];

  internalEventEmitter.on(
    "close",
    () => {
      return Promise.all(workers.map((worker) => worker.close()));
    },
    { promisify: true },
  );

  return {
    build: (name, queueOptions) => {
      const queueName = `{${name}}`;
      return {
        globalEvents: internalEventEmitter,
        events: new QueueEvents(queueName, { connection: connection() }),
        queue: new Queue(queueName, {
          connection: connection(),
          ...queueOptions,
          defaultJobOptions: {
            ...defaultJobOptions,
            ...queueOptions?.defaultJobOptions,
          },
        }),
        worker: {
          run: (processor, workerOptions) => {
            const worker = new Worker(queueName, processor, {
              ...workerOptions,
              connection: connection(),
            });
            workers.push(worker);
            return worker;
          },
        },
      };
    },
  };
}

export default bull({
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 5 * 1000,
    },
    removeOnFail: { count: 10000, age: 60 * 60 * 24 * 7 },
    removeOnComplete: { count: 10000, age: 60 * 60 },
  },
});
