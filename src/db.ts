import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AutoResult } from './cv/protocol';

export type Source = 'camera' | 'upload' | 'import';

export interface Measurement {
  id: string;
  createdAt: number;
  source: Source;
  tDevice: number; // capture time by the device clock (epoch ms)
  offsetMs: number; // applied device clock offset
  offsetErrMs: number;
  latencyMs: number; // applied camera latency correction
  tTrue: number; // corrected true capture time = tDevice + offset − latency
  watchTime: number; // time shown by the watch (epoch ms)
  drift: number; // s = watchTime − tTrue
  imgW: number;
  imgH: number;
  photo?: Blob;
  note: string;
  reset: boolean;
  method?: 'auto' | 'manual'; // auto: read by computer vision and not edited
  auto?: AutoResult;
}

export interface LatencySample {
  at: number;
  latencyMs: number;
  timeSource: string;
}

interface Schema extends DBSchema {
  measurements: { key: string; value: Measurement; indexes: { tTrue: number } };
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<Schema>> | undefined;

function db() {
  dbp ??= openDB<Schema>('watch-logger', 1, {
    upgrade(d) {
      const m = d.createObjectStore('measurements', { keyPath: 'id' });
      m.createIndex('tTrue', 'tTrue');
      d.createObjectStore('kv');
    },
  });
  return dbp;
}

export async function putMeasurement(m: Measurement) {
  await (await db()).put('measurements', m);
}

export async function getMeasurement(id: string) {
  return (await db()).get('measurements', id);
}

export async function allMeasurements(): Promise<Measurement[]> {
  return (await db()).getAllFromIndex('measurements', 'tTrue');
}

export async function deleteMeasurement(id: string) {
  await (await db()).delete('measurements', id);
}

export async function clearMeasurements() {
  await (await db()).clear('measurements');
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown) {
  await (await db()).put('kv', value, key);
}
