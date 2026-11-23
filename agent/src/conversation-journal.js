import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

export const conversationScope = new AsyncLocalStorage();
export const conversationDirectory = dataDir => join(dataDir, 'conversations');
export const isConversationId = value => typeof value === 'string'
  && /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(value);

export function taskConversationId(task) {
  if (isConversationId(task?.conversationId)) return task.conversationId;
  return isConversationId(task?.id) ? task.id : undefined;
}

function reviewText(text, limit) {
  if (typeof text !== 'string') return undefined;
  const normalized = text.normalize('NFKC');
  const credential = /密码|口令|验证码|密钥|令牌|\btoken\b|(?:access|refresh|auth)[_ -]?token|api[_ -]?key|password|passwd|\bsecret\b|bearer\s|authorization|basic\s+[a-z0-9/+]{8,}|-----BEGIN [^-]*PRIVATE KEY-----|\b(?:sk-|gh[pousr]_|github_pat_|xox[baprs]-|AKIA)[\w-]{8,}|\beyJ[\w-]+\.[\w-]+\.[\w-]+/i;
  if (credential.test(normalized)) return '［可能含凭据，已过滤］';
  const filtered = text
    .replace(/[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/gu, '［邮箱］')
    .replace(/(?<!\d)(?:\+?86[ -]?)?1[3-9]\d{9}(?!\d)/g, '［手机号］')
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, value => /[a-z]/i.test(value) && /\d/.test(value) ? '［长标识］' : value);
  return filtered.length <= limit ? filtered : filtered.slice(0, limit) + '［已截断］';
}

export async function inspectJournalDirectory(directory) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || (process.platform !== 'win32' && (stat.mode & 0o077))) {
    throw Object.assign(new Error('会话日志目录须为私有目录'), { code: 'CONVERSATION_DIRECTORY_UNSAFE' });
  }
}

export async function openJournalFile(filename, flags) {
  const file = await open(filename, flags | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0), 0o600);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (process.platform !== 'win32' && (stat.mode & 0o077))) {
      throw Object.assign(new Error('会话日志须为私有普通文件'), { code: 'CONVERSATION_FILE_UNSAFE' });
    }
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

const safeCode = code => typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : undefined;

export function createConversationJournal(dataDir) {
  const directory = conversationDirectory(dataDir);
  let warned = false;

  async function append(day, event) {
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await inspectJournalDirectory(directory);
      const file = await openJournalFile(join(directory, day + '.jsonl'), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT);
      try {
        // Start a fresh line even if an earlier write was interrupted.
        const row = Buffer.from('\n' + JSON.stringify(event) + '\n');
        const { bytesWritten } = await file.write(row);
        if (bytesWritten !== row.length) throw new Error('会话日志未完整写入');
      } finally { await file.close(); }
      warned = false;
    } catch (error) {
      if (!warned) console.warn('[小满会话记录] 无法写入会话日志', safeCode(error?.code) || 'WRITE_FAILED');
      warned = true;
    }
  }

  return async function observe({ actor, conversationId, operation, message, taskId }, execute) {
    const owner = actor.id == null ? ['username', actor.username] : ['id', Number(actor.id)];
    const sessionId = createHash('sha256').update(JSON.stringify([owner, conversationId])).digest('hex').slice(0, 32);
    const at = new Date().toISOString();
    const day = at.slice(0, 10);
    const context = { version: 1, sessionId, eventId: randomUUID(), operation,
      roleId: Number.isSafeInteger(actor.roleId) ? actor.roleId : undefined };
    await append(day, { ...context, phase: 'started', at, taskId, message: reviewText(message, 4000) });
    const start = performance.now();
    const finish = input => append(day, { ...context, phase: 'finished', at: new Date().toISOString(),
      durationMs: Math.round(performance.now() - start), ...input });
    try {
      const out = await execute();
      const task = out.task;
      await finish({ status: 200, taskId: task?.id ?? taskId, graph: task?.graph, state: task?.state,
        revision: task?.revision, reply: reviewText(out.reply, 16000) });
      return out;
    } catch (error) {
      await finish({ status: Number.isInteger(error?.status) && error.status >= 400 ? error.status : 503,
        taskId, code: safeCode(error?.code) });
      throw error;
    }
  };
}
