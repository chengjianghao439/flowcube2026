// 任务状态机与任务记忆（总体设计 §4/§6）。
// 状态迁移白名单；预览过期；每步回执与请求键持久化，服务重启可恢复。
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { TaskFiles } from './task-files.js';
import { ownsTask } from './task-access.js';
import { config } from './config.js';

export const STATES = [
  'CREATED', 'DISAMBIGUATING', 'PLANNED', 'DRY_RUNNING', 'AWAITING_CONFIRM',
  'CONFIRMED', 'EXECUTING', 'RESULT_UNKNOWN', 'VERIFYING', 'DONE',
  'FAILED_FINAL', 'ESCALATED', 'EXPIRED', 'CANCELLED',
];

const TRANSITIONS = {
  CREATED: ['DISAMBIGUATING', 'PLANNED', 'DRY_RUNNING', 'CANCELLED'],
  DISAMBIGUATING: ['PLANNED', 'DRY_RUNNING', 'CANCELLED', 'FAILED_FINAL'],
  PLANNED: ['DRY_RUNNING', 'AWAITING_CONFIRM', 'CANCELLED'],
  DRY_RUNNING: ['AWAITING_CONFIRM', 'VERIFYING', 'DONE', 'FAILED_FINAL', 'CANCELLED'],
  AWAITING_CONFIRM: ['DISAMBIGUATING', 'CONFIRMED', 'EXPIRED', 'CANCELLED'],
  CONFIRMED: ['EXECUTING', 'EXPIRED'],
  EXECUTING: ['VERIFYING', 'RESULT_UNKNOWN', 'FAILED_FINAL', 'ESCALATED'],
  RESULT_UNKNOWN: ['EXECUTING', 'VERIFYING', 'ESCALATED'],
  VERIFYING: ['DONE', 'ESCALATED', 'FAILED_FINAL', 'RESULT_UNKNOWN'],
  DONE: [], FAILED_FINAL: [], ESCALATED: ['RESULT_UNKNOWN'], EXPIRED: ['DRY_RUNNING'], CANCELLED: [],
};

export class Task {
  constructor({ graph, userText, actor }) {
    this.id = randomUUID();
    this.graph = graph;
    this.userText = userText;
    this.actor = actor ? structuredClone(actor) : 'unknown'; // 固定发起时授权快照；读取时仍复核当前授权
    this.state = 'CREATED';
    this.requestKey = `agent-${this.id}`; // 整个任务同一键，结果未知时不换键
    this.steps = [];       // {name, tool, args, receipt, at}
    this.preview = null;   // {lines, totalCents, builtAt, expiresAt, payload}
    this.result = null;
    this.error = null;
    this.reply = null;
    this.candidates = null;
    this.revision = 0;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.history = [{ state: 'CREATED', at: this.createdAt }];
  }

  transition(to) {
    const allowed = TRANSITIONS[this.state] || [];
    if (!allowed.includes(to)) {
      throw new Error(`非法状态迁移 ${this.state} → ${to}`);
    }
    this.state = to;
    this.updatedAt = new Date().toISOString();
    this.history.push({ state: to, at: this.updatedAt });
  }

  recordStep(name, tool, receipt) {
    this.steps.push({ name, tool, receipt, at: new Date().toISOString() });
    this.updatedAt = new Date().toISOString();
  }

  setPreview(preview) {
    const now = Date.now();
    this.preview = { ...preview, builtAt: new Date(now).toISOString(), expiresAt: new Date(now + config.previewTtlMs).toISOString() };
    this.revision = (Number(this.revision) || 0) + 1;
    this.updatedAt = new Date(now).toISOString();
  }

  previewExpired() {
    return this.preview && Date.now() > new Date(this.preview.expiresAt).getTime();
  }
}

function validateTaskRecords(rows) {
  if (!Array.isArray(rows)) throw new Error('任务记录不是数组');
  const ids = new Set();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.id !== 'string' || !/^[\w-]{1,100}$/.test(raw.id)
      || typeof raw.graph !== 'string' || !raw.graph || !STATES.includes(raw.state) || ids.has(raw.id)) throw new Error('任务记录格式错误或编号重复');
    ids.add(raw.id);
  }
}

export function loadTaskGroups(file) {
  return new TaskFiles(file, validateTaskRecords).load();
}

function restoreTask(raw) {
  const task = Object.assign(new Task({ graph: raw.graph, userText: raw.userText, actor: raw.actor }), raw);
  task.updatedAt = raw.updatedAt || raw.history?.at(-1)?.at || raw.createdAt || task.createdAt;
  return task;
}

function storageUnavailable() {
  return Object.assign(new Error('小满的历史记录暂时无法读取，原文件已保留。请联系管理员修复后再试。'), {
    code: 'ASSISTANT_HISTORY_UNAVAILABLE', status: 503,
  });
}

const nameOf = actor => typeof actor === 'string' ? actor : actor?.username;
const sortTimestamp = (task, orderBy) => String(task[orderBy] || task.createdAt);

export class TaskStore {
  #files;
  #locations = new Map();
  #groupSize = new Map();
  #owners = new Map();
  #failedWrites = new Set();

  constructor(file) {
    this.tasks = new Map();
    this.locks = new Set();
    if (!file) return;
    this.#files = new TaskFiles(file, validateTaskRecords);
    try { this.#loadGroups(this.#files.load()); }
    catch { throw storageUnavailable(); }
  }

  static async open(file) {
    const store = new TaskStore(null);
    if (!file) return store;
    store.#files = new TaskFiles(file, validateTaskRecords);
    try {
      if (!store.#files.hasHistory()) return store;
      await new Promise((resolve, reject) => {
        const loader = new Worker(new URL('./task-loader.js', import.meta.url), { workerData: file, env: {}, execArgv: [] });
        let finished = false;
        loader.on('message', message => {
          try {
            if (message.done) finished = true;
            else store.#loadGroups(message.groups);
          } catch (error) {
            reject(error);
            void loader.terminate();
          }
        });
        loader.once('error', reject);
        loader.once('exit', code => {
          if (code === 0 && finished) resolve();
          else reject(storageUnavailable());
        });
      });
      store.#files.ready = true;
      return store;
    } catch {
      throw storageUnavailable();
    }
  }

  #loadGroups(groups) {
    for (const rows of groups) {
      const root = rows[0].id;
      for (const row of rows) this.#register(restoreTask(row), root);
      this.#groupSize.set(root, rows.length);
    }
  }

  #trackOwner(key, id) {
    if (!this.#owners.has(key)) this.#owners.set(key, new Set());
    this.#owners.get(key).add(id);
  }

  #register(task, root) {
    this.tasks.set(task.id, task);
    this.#locations.set(task.id, root);
    const name = nameOf(task.actor);
    if (task.actor?.id != null) this.#trackOwner(`id:${Number(task.actor.id)}`, task.id);
    else if (name) this.#trackOwner(`legacy:${name}`, task.id);
    if (name) this.#trackOwner(`name:${name}`, task.id);
  }

  #saveGroup(root, tasks) {
    try { this.#files?.saveGroup(root, tasks); }
    catch {
      if (this.#groupSize.has(root)) this.#failedWrites.add(root);
      throw storageUnavailable();
    }
  }

  create(init) {
    const task = new Task(init);
    this.#saveGroup(task.id, [task]);
    this.#groupSize.set(task.id, 1);
    this.#register(task, task.id);
    return task;
  }

  /** 收款记录与其第二段核销任务在同一原子文件发布。 */
  createRelated(parent, init, prepare) {
    if (this.get(parent.id) !== parent || this.#groupSize.get(parent.id) !== 1) throw storageUnavailable();
    const child = new Task(init);
    const preparedParent = restoreTask(structuredClone(parent));
    prepare(child, preparedParent);
    const owner = typeof preparedParent.actor === 'string' ? { username: preparedParent.actor } : preparedParent.actor;
    if (!ownsTask(child, owner)) throw storageUnavailable();
    this.#saveGroup(parent.id, [preparedParent, child]);
    Object.assign(parent, preparedParent);
    this.#groupSize.set(parent.id, 2);
    this.#register(child, parent.id);
    return child;
  }

  get(id) {
    if (this.#failedWrites.has(this.#locations.get(id))) throw storageUnavailable();
    return this.tasks.get(id) || null;
  }

  *pagesForActor(actor, { pageSize = 64, orderBy = 'updatedAt' } = {}) {
    const candidates = actor?.id == null
      ? this.#owners.get(`name:${actor?.username}`) || []
      : [
        ...(this.#owners.get(`id:${Number(actor.id)}`) || []),
        ...(this.#owners.get(`legacy:${actor.username}`) || []),
      ];
    const ordered = [];
    for (const id of candidates) {
      const task = this.tasks.get(id);
      if (ownsTask(task, actor)) ordered.push(task);
    }
    ordered.sort((left, right) => sortTimestamp(right, orderBy).localeCompare(sortTimestamp(left, orderBy))
      || left.id.localeCompare(right.id));
    const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 64;
    for (let start = 0; start < ordered.length; start += size) {
      yield ordered.slice(start, start + size).map(task => this.get(task.id));
    }
  }

  // 选择、重选、作废、改量、确认和原结果恢复共用任务锁。
  async exclusive(id, operation) {
    if (this.locks.has(id)) throw Object.assign(new Error('此任务正在处理中，请稍候查询原结果'), { status: 409, code: 'TASK_BUSY' });
    this.locks.add(id);
    try { return await operation(); }
    finally { this.locks.delete(id); }
  }

  save(task) {
    if (this.get(task.id) !== task) throw storageUnavailable();
    if (!this.#files) return;
    const root = this.#locations.get(task.id);
    let rows = [task];
    if (this.#groupSize.get(root) === 2) {
      try {
        const committed = this.#files.readGroup(root);
        if (committed.length !== 2 || !committed.some(record => record.id === task.id)) throw storageUnavailable();
        rows = committed.map(record => record.id === task.id ? task : record);
      } catch {
        this.#failedWrites.add(root);
        throw storageUnavailable();
      }
    }
    this.#saveGroup(root, rows);
  }
}
