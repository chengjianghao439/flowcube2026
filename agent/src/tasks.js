// 任务状态机与任务记忆（总体设计 §4/§6）。
// 状态迁移白名单；预览过期；每步回执与请求键持久化，服务重启可恢复。
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
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
  AWAITING_CONFIRM: ['CONFIRMED', 'EXPIRED', 'CANCELLED'],
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

export class TaskStore {
  constructor(file) {
    this.file = file;
    this.tasks = new Map();
    this.locks = new Set();
    if (file) {
      try {
        const arr = JSON.parse(readFileSync(file, 'utf8'));
        if (!Array.isArray(arr)) throw new Error('任务记录不是数组');
        const ids = new Set();
        for (const raw of arr) {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.id !== 'string' || !/^[\w-]{1,100}$/.test(raw.id)
            || typeof raw.graph !== 'string' || !raw.graph || !STATES.includes(raw.state) || ids.has(raw.id)) throw new Error('任务记录格式错误或编号重复');
          ids.add(raw.id);
        }
        for (const raw of arr) {
          const t = Object.assign(new Task({ graph: raw.graph, userText: raw.userText, actor: raw.actor }), raw);
          t.updatedAt = raw.updatedAt || raw.history?.at(-1)?.at || raw.createdAt || t.createdAt;
          this.tasks.set(t.id, t);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw Object.assign(new Error('小满的历史记录暂时无法读取，原文件已保留。请联系管理员修复后再试。'), { code: 'ASSISTANT_HISTORY_UNAVAILABLE', status: 503 });
      }
    }
  }

  create(init) {
    const t = new Task(init);
    this.tasks.set(t.id, t);
    this.persist();
    return t;
  }

  get(id) { return this.tasks.get(id) || null; }

  // 选择、改量、确认和原结果恢复用同一把任务锁，拒绝交错变更预览或重复执行。
  async exclusive(id, operation) {
    if (this.locks.has(id)) throw Object.assign(new Error('此任务正在处理中，请稍候查询原结果'), { status: 409, code: 'TASK_BUSY' });
    this.locks.add(id);
    try { return await operation(); }
    finally { this.locks.delete(id); }
  }

  persist() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.tasks.values()], null, 2), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.file);
  }

  save() { this.persist(); }
}
