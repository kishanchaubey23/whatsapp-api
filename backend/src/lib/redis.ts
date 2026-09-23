import { createClient, type RedisClientType } from 'redis';
import { config } from '../config.js';

let client: RedisClientType | null = null;

export async function getRedis(): Promise<RedisClientType> {
  if (client?.isOpen) return client;
  client = createClient({ url: config.redisUrl });
  client.on('error', (err) => console.error('[redis]', err));
  await client.connect();
  return client;
}

export async function enqueueJob(payload: unknown): Promise<void> {
  const r = await getRedis();
  await r.lPush(config.queueName, JSON.stringify(payload));
}

export async function dequeueJob<T>(): Promise<T | null> {
  const r = await getRedis();
  const raw = await r.brPop(config.queueName, 5);
  if (!raw) return null;
  return JSON.parse(raw.element) as T;
}

export async function publishEvent(channel: string, payload: unknown): Promise<void> {
  const r = await getRedis();
  await r.publish(channel, JSON.stringify(payload));
}
