// 小满私有任务文件。同一任务的数据通过同目录原子替换发布。
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

const ID = /^[\w-]{1,100}$/;
const TEMP = /^\.task-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.tmp$/;
const MANIFEST = '.manifest.json';

function statIfPresent(path) {
  try { return lstatSync(path); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function readRegularFile(path, encoding) {
  if (!lstatSync(path).isFile()) throw new Error('任务记录须为普通文件');
  return readFileSync(path, encoding);
}

function flushDirectory(directory) {
  if (process.platform === 'win32') return;
  const handle = openSync(directory, 'r');
  try { fsyncSync(handle); }
  finally { closeSync(handle); }
}

function atomicWrite(directory, filename, value) {
  const temporary = join(directory, `.task-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600, flush: true });
    renameSync(temporary, join(directory, filename));
  } finally {
    try { unlinkSync(temporary); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export class TaskFiles {
  constructor(file, validate) {
    this.legacy = file;
    this.directory = join(dirname(file), basename(file) === 'tasks.json' ? 'tasks-v2' : `${basename(file)}.v2`);
    this.validate = validate;
    this.ready = false;
  }

  hasHistory() {
    return Boolean(statIfPresent(this.directory) || statIfPresent(this.legacy));
  }

  load() {
    const published = statIfPresent(this.directory);
    if (published) {
      if (!published.isDirectory()) throw new Error('任务目录无效');
      return this.readPublished();
    }
    if (!statIfPresent(this.legacy)) return [];
    const legacy = readRegularFile(this.legacy);
    const rows = JSON.parse(legacy.toString('utf8'));
    this.validate(rows);
    const hash = createHash('sha256').update(legacy).digest('hex');
    this.initialize(rows, hash);
    return rows.map(row => [row]);
  }

  initialize(rows, legacySha256 = null) {
    const parent = dirname(this.directory);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const stage = mkdtempSync(join(parent, '.task-import-'));
    let published = false;
    try {
      for (const row of rows) atomicWrite(stage, `${row.id}.json`, [row]);
      atomicWrite(stage, MANIFEST, { formatVersion: 2, legacySha256, importedIds: rows.map(row => row.id) });
      flushDirectory(stage);
      renameSync(stage, this.directory);
      published = true;
      flushDirectory(parent);
      this.ready = true;
    } finally {
      if (!published) rmSync(stage, { recursive: true, force: true });
    }
  }

  validateGroup(id, rows) {
    this.validate(rows);
    if (rows.length < 1 || rows.length > 2 || rows[0].id !== id) throw new Error('任务文件和内容不匹配');
    if (rows.length === 2 && (rows[0].graph !== 'D-receipt' || rows[0].result?.stage2TaskId !== rows[1].id || rows[1].graph !== 'D-settle')) {
      throw new Error('收款与核销记录不匹配');
    }
    return rows;
  }

  readGroup(id) {
    if (!ID.test(id)) throw new Error('任务编号无效');
    const rows = JSON.parse(readRegularFile(join(this.directory, `${id}.json`), 'utf8'));
    return this.validateGroup(id, rows);
  }

  readPublished() {
    const manifest = JSON.parse(readRegularFile(join(this.directory, MANIFEST), 'utf8'));
    if (manifest?.formatVersion !== 2 || !Array.isArray(manifest.importedIds)
      || !manifest.importedIds.every(id => typeof id === 'string' && ID.test(id))
      || new Set(manifest.importedIds).size !== manifest.importedIds.length
      || !(manifest.legacySha256 === null || /^[\da-f]{64}$/.test(manifest.legacySha256))
      || (manifest.legacySha256 === null && manifest.importedIds.length)) {
      throw new Error('任务目录清单无效');
    }
    const groups = [];
    const ids = new Set();
    for (const name of readdirSync(this.directory)) {
      if (name === MANIFEST) continue;
      if (TEMP.test(name) && lstatSync(join(this.directory, name)).isFile()) continue;
      const id = name.endsWith('.json') ? name.slice(0, -5) : '';
      const rows = this.readGroup(id);
      for (const row of rows) {
        if (ids.has(row.id)) throw new Error('任务编号重复');
        ids.add(row.id);
      }
      groups.push(rows);
    }
    if (manifest.importedIds.some(id => !ids.has(id))) throw new Error('导入任务缺失');
    this.ready = true;
    return groups;
  }

  saveGroup(id, rows) {
    this.validateGroup(id, rows);
    if (!this.ready) this.initialize([]);
    atomicWrite(this.directory, `${id}.json`, rows);
    flushDirectory(this.directory);
  }
}
