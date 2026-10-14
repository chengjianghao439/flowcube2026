import { expect, test } from 'vitest'
import { cashCents, cashText } from './cashCent'
test.each([['.01',1n],['1e-2',1n],['12.3400',1234n],['0.1',10n],['-.01',-1n],['0',0n]] as const)('exact decimal cents %s', (value, expected)=>{expect(cashCents(value)).toBe(expected)})
test.each(['.001','.0067','.8999','12.3456','1.23456','NaN','Infinity','1e999','90071992547409.91'])('cannot round or lose a cash cent in %s',value=>{expect(cashCents(value)).toBeNull()})
test('cent formatting and accumulation retain the final .01 without float arithmetic',()=>{expect(cashText(cashCents('.1')!+cashCents('.2')!)).toBe('0.30');expect(cashText(1n)).toBe('0.01');expect(cashText(-1n)).toBe('-0.01')})
