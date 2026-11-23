import { SEQUENCE_GRAPH, READ_STEPS } from './composite-routing.js';

export function createReadSequence(store, actor, text, steps) {
  const task = store.create({ graph: SEQUENCE_GRAPH, userText: text, actor });
  task.sequence = { steps };
  task.transition('DRY_RUNNING');
  store.save(task);
  return task;
}

export async function advanceReadSequence(store, task, run, input) {
  if (task.state === 'DONE') return { task, reply: task.reply, result: task.result };
  if (task.state === 'PAUSED') task.transition('DRY_RUNNING');
  const { steps } = task.sequence;
  const index = steps.findIndex(step => !step.completedId);
  for (let i = index; i >= 0 && i < steps.length; i++) {
    const step = steps[i];
    let out;
    try { out = await run(step, i === index ? input : undefined); }
    catch (error) {
      if (error.code === 'ASSISTANT_HISTORY_UNAVAILABLE') throw error;
      if (input?.choiceId != null && error.status >= 400 && error.status < 500) {
        task.transition('PAUSED'); store.save(task); throw error;
      }
      out = { reply: error.status === 403 ? '当前账号没有这一步的查看权限或仓库范围。' : '查询暂时不可用。' };
    }
    if (out.task?.state === 'DONE') {
      step.completedId = out.task.id;
      step.activeId = null;
      task.candidates = null;
      store.save(task); // 每步独立保存，续办从第一个未完成的步骤开始。
      continue;
    }

    const needsInput = out.task?.state === 'DISAMBIGUATING';
    step.activeId = needsInput ? out.task.id : null;
    task.candidates = needsInput ? out.candidates ?? out.task?.candidates ?? null : null;
    task.transition('PAUSED');
    const summary = report(store, task, {
      index: i,
      reply: out.task?.state === 'ESCALATED' ? '查询结果需人工核对。' : out.reply || '查询暂未完成。',
      instruction: needsInput ? '请补充这一步的信息或选择候选，办完后再继续下一步。' : '可以说「继续原任务」，我会从这个步骤重查。',
    });
    task.reply = summary;
    store.save(task);
    return { task, reply: summary, candidates: task.candidates, result: task.result };
  }
  task.transition('DONE');
  const reply = report(store, task);
  task.reply = reply;
  store.save(task);
  return { task, reply, result: task.result };
}

function report(store, task, stopped) {
  const items = task.sequence.steps.map((step, i) => ({
    position: i + 1,
    label: READ_STEPS[step.graph],
    status: step.completedId ? '已完成' : stopped?.index === i ? '暂停' : '未执行',
  }));
  task.result = { items };
  const details = items.map(({ position, label, status }, i) => {
    const step = task.sequence.steps[i];
    const header = `第 ${position} 步 · ${label} · ${status}`;
    if (step.completedId) return header + '\n' + store.get(step.completedId).reply;
    if (stopped?.index === i) return [header, stopped.reply, stopped.instruction].join('\n');
    return header;
  });
  return details.join('\n\n');
}
