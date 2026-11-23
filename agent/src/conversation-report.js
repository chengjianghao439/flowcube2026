import { constants } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config } from './config.js';
import { conversationDirectory, inspectJournalDirectory, isConversationId, openJournalFile } from './conversation-journal.js';

const SESSION_ID = /^[a-f0-9]{32}$/;
const DAY = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
const REVIEW = new Set(['DISAMBIGUATING', 'PAUSED', 'EXPIRED', 'RESULT_UNKNOWN', 'ESCALATED', 'FAILED_FINAL']);

async function readRequests(dataDir, days, sessionId) {
  const directory = conversationDirectory(dataDir);
  const requests = new Map();
  let invalidLines = 0;
  let files;
  try {
    await inspectJournalDirectory(directory);
    files = await readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return { requests: [], invalidLines };
    throw error;
  }
  const cutoff = new Date(Math.max(0, Date.now() - (days - 1) * 86400000)).toISOString().slice(0, 10);
  for (const day of files.filter(file => DAY.test(file) && file.slice(0, 10) >= cutoff).sort()) {
    const file = await openJournalFile(join(directory, day), constants.O_RDONLY);
    try {
      const reader = createInterface({ input: file.createReadStream({ autoClose: false }), crlfDelay: Infinity });
      for await (const line of reader) {
        if (!line.trim()) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { invalidLines++; continue; }
        if (!entry || entry.version !== 1 || !SESSION_ID.test(entry.sessionId) || !isConversationId(entry.eventId)
            || !['started', 'finished'].includes(entry.phase) || typeof entry.at !== 'string') {
          invalidLines++;
          continue;
        }
        if (sessionId && entry.sessionId !== sessionId) continue;
        const id = entry.sessionId + ':' + entry.eventId;
        const request = requests.get(id) ?? { eventId: entry.eventId, sessionId: entry.sessionId,
          operation: entry.operation, roleId: entry.roleId };
        if (entry.phase === 'started') {
          Object.assign(request, { startedAt: entry.at, message: entry.message });
        } else {
          Object.assign(request, { finishedAt: entry.at, durationMs: entry.durationMs, status: entry.status,
            code: entry.code, state: entry.state, graph: entry.graph, revision: entry.revision, reply: entry.reply });
        }
        if (entry.taskId) request.taskId = entry.taskId;
        requests.set(id, request);
      }
    } finally { await file.close(); }
  }
  return { requests: [...requests.values()].sort((a, b) => (a.startedAt ?? a.finishedAt).localeCompare(b.startedAt ?? b.finishedAt)), invalidLines };
}

export async function summarizeConversations(dataDir, { days = 7, sessionId, limit = 50 } = {}) {
  if (!Number.isSafeInteger(days) || days < 1 || !Number.isSafeInteger(limit) || limit < 1) throw new Error('天数和结果上限须为正整数');
  if (sessionId != null && (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId))) throw new Error('会话编号须为 32 位十六进制');
  const { requests, invalidLines } = await readRequests(dataDir, days, sessionId);
  if (sessionId) return { days, sessionId, invalidLines, requests };
  const conversations = new Map();
  const totals = { conversations: 0, requests: requests.length, chatTurns: 0, errors: 0, awaitingResult: 0, needsReview: 0 };
  const times = [];
  for (const row of requests) {
    const at = row.finishedAt ?? row.startedAt;
    const session = conversations.get(row.sessionId) ?? { sessionId: row.sessionId, roleId: row.roleId, requests: 0,
      chatTurns: 0, errors: 0, needsReview: 0, lastActivityAt: at };
    session.requests++;
    if (row.operation === 'chat') { totals.chatTurns++; session.chatTurns++; }
    if (row.status >= 400) { totals.errors++; session.errors++; }
    if (!row.finishedAt) totals.awaitingResult++;
    if (!row.finishedAt || row.status >= 400 || REVIEW.has(row.state)) { totals.needsReview++; session.needsReview++; }
    if (Number.isSafeInteger(row.durationMs) && row.durationMs >= 0) times.push(row.durationMs);
    if (at >= session.lastActivityAt) {
      session.lastActivityAt = at;
      session.lastState = row.state ?? (row.finishedAt ? row.status >= 400 ? 'ERROR' : 'REPLIED' : 'UNFINISHED');
    }
    conversations.set(row.sessionId, session);
  }
  totals.conversations = conversations.size;
  times.sort((a, b) => a - b);
  const latencyMs = { p50: times[Math.ceil(times.length * 0.5) - 1] ?? null, p95: times[Math.ceil(times.length * 0.95) - 1] ?? null };
  const recent = [...conversations.values()].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, limit);
  return { days, totals, latencyMs, invalidLines, recent };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'data-dir': { type: 'string' }, days: { type: 'string' },
      session: { type: 'string' }, limit: { type: 'string' }, help: { type: 'boolean' } } });
    if (values.help) {
      process.stdout.write('用法：node agent/src/conversation-report.js [--data-dir 路径] [--days 7] [--limit 50] [--session 会话编号]\n');
    } else {
      const report = await summarizeConversations(values['data-dir'] ?? config.dataDir,
        { days: Number(values.days ?? 7), sessionId: values.session, limit: Number(values.limit ?? 50) });
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    }
  } catch (error) {
    process.stderr.write('无法读取小满会话记录：' + error.message + '\n');
    process.exitCode = 1;
  }
}
