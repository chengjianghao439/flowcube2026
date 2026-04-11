#!/usr/bin/env node
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

const { runMigrations } = require('../src/database/migrate')
const svc = require('../src/modules/reports/reports.service')

const checks = [
  {
    name: 'purchaseStats',
    run: () => svc.purchaseStats({}),
  },
  {
    name: 'saleStats',
    run: () => svc.saleStats({}),
  },
  {
    name: 'inventoryStats',
    run: () => svc.inventoryStats({}),
  },
  {
    name: 'pdaPerformance',
    run: () => svc.pdaPerformance(),
  },
  {
    name: 'wavePerformance',
    run: () => svc.wavePerformance({}),
  },
  {
    name: 'warehouseOps',
    run: () => svc.warehouseOps(),
  },
  {
    name: 'roleWorkbench',
    run: () => svc.roleWorkbench(),
  },
  {
    name: 'reconciliationReport(type=1)',
    run: () => svc.reconciliationReport({ type: 1, page: 1, pageSize: 5 }),
  },
  {
    name: 'reconciliationReport(type=2)',
    run: () => svc.reconciliationReport({ type: 2, page: 1, pageSize: 5 }),
  },
  {
    name: 'profitAnalysis',
    run: () => svc.profitAnalysis({}),
  },
]

async function main() {
  console.log('Running migrations before smoke checks...')
  await runMigrations()

  const failed = []
  for (const check of checks) {
    try {
      const result = await check.run()
      const summary = result && typeof result === 'object'
        ? Object.keys(result).slice(0, 8).join(', ')
        : typeof result
      console.log(`OK  ${check.name} -> ${summary}`)
    } catch (error) {
      failed.push({ name: check.name, error })
      console.error(`FAIL ${check.name} -> ${error.message}`)
    }
  }

  if (failed.length > 0) {
    console.error(`\\n报表烟雾检查失败，共 ${failed.length} 项`)
    process.exitCode = 1
    return
  }

  console.log('\\n报表烟雾检查通过')
}

main().catch((error) => {
  console.error('报表烟雾检查执行失败:', error)
  process.exit(1)
})
