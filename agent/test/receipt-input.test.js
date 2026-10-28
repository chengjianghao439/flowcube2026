import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReceiptAmount } from '../src/receipt-amount.js';

test('原句金额、单号、日期、客户编码各自保留', () => {
  const parsed = parseReceiptAmount('甲公司C000123于2026-10-26付了25元，把SL20261026009那笔核销掉');
  assert.equal(parsed.amountCents, 2500);
  assert.equal(parsed.customerKeyword, '甲公司C000123');
  assert.deepEqual(parsed.customerCodes, ['C000123']);
  assert.deepEqual(parsed.dates, ['2026-10-26']);
  assert.deepEqual(parsed.targetRefs, ['SL20261026009']);
});
test('单号在付款前后都不当金额，多个目标不丢失', () => {
  for (const text of ['甲公司SL20261026009到账25元核销', '甲公司到账25元，核销SL20261026009和SL20261026010']) {
    const parsed = parseReceiptAmount(text);
    assert.equal(parsed.amountCents, 2500);
    assert.ok(parsed.targetRefs.includes('SL20261026009'));
  }
});
for (const raw of ['25元或30元', '-25元', '0.001元', '5e2元', '5万元', '五元', '若干元', '1,000元']) {
  test(`存在单号仍拒绝无效或多个金额：${raw}`, () => {
    assert.throws(() => parseReceiptAmount(`甲公司付了${raw}，把SL20261026009那笔核销掉`), /金额|数字/);
  });
}
test('全额不把客户编码当金额', () => {
  const parsed = parseReceiptAmount('给甲公司C000123核销');
  assert.equal(parsed.amountCents, null);
  assert.equal(parsed.customerKeyword, '给甲公司C000123');
  assert.equal(parsed.commandCustomerKeyword, '甲公司C000123');
});
for (const name of ['AB123五金公司', '和盛五金', '钱先生', '只一公司', '甲公司C000123', '甲公司KH000123']) {
  test(`客户名称与编码内部字母数字保留：${name}`, () => {
    for (const suffix of ['付了25元核销', '到账25元核销', '核销']) {
      const parsed = parseReceiptAmount(`${name}${suffix}`);
      assert.equal(parsed.customerKeyword, name);
      assert.deepEqual(parsed.targetRefs, []);
      assert.equal(parsed.amountCents, suffix === '核销' ? null : 2500);
    }
  });
}
test('明确单号语境保留自定义前缀目标，不能藏入客户名', () => {
  const parsed = parseReceiptAmount('甲公司到账25元，核销单号AB123');
  assert.deepEqual(parsed.targetRefs, ['AB123']);
});
for (const text of ['甲公司25核销', '123五金核销']) {
  test(`无货币单位和付款语境的裸数字不能猜成金额或删掉客户数字：${text}`, () => {
    assert.throws(() => parseReceiptAmount(text), /金额|数字/);
  });
}
for (const name of ['邀请', '张给']) {
  test(`客户名称尾字不能被重复剥前后缀：${name}`, () => {
    assert.equal(parseReceiptAmount(`${name}付了25元核销`).customerKeyword, name);
  });
}
for (const name of ['张钱', '给力五金', '帮忙商贸', '请益公司']) {
  test(`不吞客户原名首词或到账前的尾字：${name}`, () => {
    const parsed = parseReceiptAmount(`${name}到账25元核销`);
    assert.equal(parsed.customerKeyword, name);
    assert.equal(parsed.amountCents, 2500);
  });
}
for (const name of ['甲收款五金', '甲核销服务']) {
  test(`客户名内业务名词不是实际付款谓词：${name}`, () => {
    assert.equal(parseReceiptAmount(`${name}到账25元核销`).customerKeyword, name);
  });
}
