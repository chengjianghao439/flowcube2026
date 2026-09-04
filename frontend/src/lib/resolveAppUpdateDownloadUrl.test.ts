import { expect, test } from 'vitest'
import { isValidDownloadUrl, resolveAppUpdateDownloadUrl } from './resolveAppUpdateDownloadUrl'

test('renderer follows the main-process HTTPS-only download policy', () => {
  expect(isValidDownloadUrl('http://updates.example.test/setup.exe')).toBe(false)
  expect(isValidDownloadUrl('https://updates.example.test/setup.exe')).toBe(true)
})
test('an HTTP manifest link falls back to the configured HTTPS file path in both layers', () => {
  expect(resolveAppUpdateDownloadUrl({ url: 'http://legacy.example.test/setup.exe', filename: 'setup.exe' }, 'https://erp.example.test'))
    .toBe('https://erp.example.test/current/setup.exe')
})
test('relative and GitHub mirror links preserve the expected manifest URL', () => {
  expect(resolveAppUpdateDownloadUrl({ url: '/versions/2.0.0/setup.exe' }, 'https://erp.example.test'))
    .toBe('https://erp.example.test/versions/2.0.0/setup.exe')
  expect(resolveAppUpdateDownloadUrl({ url: 'https://github.com/example/erp/releases/download/v2.0.0/setup.exe', filename: 'setup.exe' }, 'https://erp.example.test'))
    .toBe('https://erp.example.test/current/setup.exe')
})
