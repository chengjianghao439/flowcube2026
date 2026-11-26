'use strict'

function onEveryPr(value) {
  const condition = typeof value === 'string' ? value.trim().replace(/^\$\{\{\s*|\s*\}\}$/g, '') : value
  return condition === undefined || condition === true || condition === 'true' || condition === 'success()'
}

function propagatesFailure(value) {
  return value === undefined || value === false
}

// Accept the direct npm and Node invocations CI uses today. An arbitrary shell script
// mentioning a command (including a comment or a heredoc) is not evidence it runs.
function reachableWorkflowCommands(workflow) {
  const commands = []
  if (!Object.hasOwn(workflow.on || {}, 'pull_request')) return commands
  for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
    if (!onEveryPr(job.if) || !propagatesFailure(job['continue-on-error'])) continue
    for (const step of job.steps || []) {
      if (!onEveryPr(step.if) || !propagatesFailure(step['continue-on-error']) || typeof step.run !== 'string') continue
      const run = step.run.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')).join('\n')
      const chain = run.split(/\s+&&\s+/)
      if (!chain.every(command => /^npm run [\w:-]+$|^npm run smoke:\$\{\{ matrix\.suite \}\}$|^node(?: --test)?(?: tests\/[\w./-]+\.js)+$/.test(command))) continue
      for (const command of chain) commands.push({ command, env: step.env, job, jobName })
    }
  }
  return commands
}

function workflowScriptReachability({ scripts, workflow, ownedRunner }) {
  const reachable = reachableWorkflowCommands(workflow)
  const commands = new Set(reachable.map(entry => entry.command))
  const directTestFiles = new Set(reachable.flatMap(({ command }) =>
    command.startsWith('node ') ? command.split(' ').filter(arg => arg.startsWith('tests/')) : []))
  const matrixSuites = new Set(reachable
    .filter(entry => entry.command === 'npm run smoke:${{ matrix.suite }}')
    .flatMap(entry => entry.job.strategy?.matrix?.suite || []))
  const ownedModes = {
    'smoke:go-live-runtime': 'go-live',
    'smoke:inbound-edit-runtime': 'inbound-edit',
    'smoke:retention-reprint-runtime': 'retention-reprint',
    'smoke:change-records-runtime': 'change-records',
    'smoke:change-records-regressions': 'change-records',
    'smoke:pda-audit-log-api-runtime': 'pda-audit-log-api',
    'smoke:pda-audit-log-migration-runtime': 'pda-audit-log-migration',
  }

  return name => {
    if (commands.has(`npm run ${name}`)) return true
    if (name.startsWith('smoke:') && matrixSuites.has(name.slice('smoke:'.length))) return true
    // This explicit mapping keeps fixture writes behind the owned runner.
    if (['smoke:purchase-repair', 'smoke:legacy-receivable-repair'].includes(name)) {
      const branches = ownedRunner.split('\nelse\n')
      const repair = branches.at(-1).split('\nfi\n')[0]
      return commands.has('npm run repair:smoke-ephemeral')
        && scripts['repair:smoke-ephemeral'] === 'bash scripts/repair-smoke-ephemeral.sh'
        && repair.split('\n').some(line => line.trim() === 'run_smoke ' + name)
    }
    const mode = ownedModes[name]
    if (mode) {
      const dispatcher = `smoke:${mode}-owned`
      return scripts[dispatcher] === `bash scripts/repair-smoke-ephemeral.sh --${mode}` &&
        ownedRunner.split('\n').some(line => line.trim() === `run_smoke ${name}`) &&
        reachable.some(entry => entry.command === `npm run ${dispatcher}` &&
          (name !== 'smoke:change-records-regressions' || entry.env?.FLOWCUBE_CHANGE_REGRESSIONS === '1'))
    }
    const files = scripts[name].match(/tests\/[\w./-]+\.js/g) || []
    return files.length > 0 && files.every(file => directTestFiles.has(file))
  }
}

module.exports = { onEveryPr, propagatesFailure, reachableWorkflowCommands, workflowScriptReachability }
