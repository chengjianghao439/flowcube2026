import { readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'

const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
const pagesRoot = resolve(sourceRoot, 'pages')

test.each([
  'components/shared/OrderFulfillmentPanel.tsx',
  'hooks/useInboundTaskCreateRecovery.ts',
  'lib/orderPrintData.ts',
  'lib/saleCommercialDisplay.ts',
  'types/inbound-tasks.ts',
])('%s 的共享逻辑不从页面模块取实现或类型', (file) => {
  const sourceFile = resolve(sourceRoot, file)
  const { importedFiles } = ts.preProcessFile(readFileSync(sourceFile, 'utf8'), true, true)
  const pageImports = importedFiles.map(({ fileName }) => fileName).filter((specifier) => {
    const target = specifier.startsWith('@/')
      ? resolve(sourceRoot, specifier.slice(2))
      : resolve(dirname(sourceFile), specifier)
    return target === pagesRoot || target.startsWith(pagesRoot + sep)
  })
  expect(pageImports).toEqual([])
})
