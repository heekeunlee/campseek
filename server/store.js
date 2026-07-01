// 감시(watch) 목록을 JSON 파일에 저장하는 초경량 저장소 (무의존성)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const FILE = join(DATA_DIR, 'watches.json');

function load() {
  if (!existsSync(FILE)) return [];
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return [];
  }
}

function persist(list) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(list, null, 2));
}

let watches = load();

export function listWatches() {
  return watches;
}

export function getWatch(id) {
  return watches.find((w) => w.id === id);
}

export function addWatch(data) {
  const w = {
    id: randomUUID(),
    arcd: data.arcd || '',
    insttId: data.insttId || '',
    label: data.label || '',
    beginDate: data.beginDate,
    endDate: data.endDate,
    section: data.section || '01',
    active: true,
    lastCheckedAt: null,
    lastAvailableCount: null,
    lastNotifiedAt: null,
    createdAt: new Date().toISOString(),
  };
  watches.push(w);
  persist(watches);
  return w;
}

export function updateWatch(id, patch) {
  const w = getWatch(id);
  if (!w) return null;
  Object.assign(w, patch);
  persist(watches);
  return w;
}

export function removeWatch(id) {
  const before = watches.length;
  watches = watches.filter((w) => w.id !== id);
  if (watches.length !== before) persist(watches);
  return watches.length !== before;
}
