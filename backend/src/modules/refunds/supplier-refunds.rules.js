'use strict'
const crypto = require('node:crypto')
const AppError = require('../../utils/AppError')
const { beijingTodayYmd } = require('../../utils/backendTime')
const { moneyUnits, moneyText } = require('../../utils/decimalMoney')
const fail = (message = '原付款或采购退货来源不完整，请人工核对') => new AppError(message, 409, 'SUPPLIER_REFUND_SOURCE_INVALID')
function safeId(value) {
  if (!(typeof value === 'number' || typeof value === 'string' && /^[1-9]\d*$/.test(value)) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new AppError('参数必须为单个正安全整数',400,'SUPPLIER_REFUND_INPUT_INVALID')
  return Number(value)
}
function uuid(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)) throw new AppError('请保留正确的原操作标识',400,'SUPPLIER_REFUND_INPUT_INVALID')
  return value.toLowerCase()
}
function requestKey(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length>100) throw new AppError('请保留原请求键',400,'REQUEST_KEY_REQUIRED')
  return value
}
function stableJson(value) {
  return JSON.stringify(value,(_key,item)=>item && typeof item==='object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])) : item)
}
const fingerprint = value => crypto.createHash('sha256').update(value).digest('hex')
function date(value) {
  let text
  try {
    text = typeof value === 'string' ? value : value && typeof value.getTime === 'function' && Number.isFinite(value.getTime()) ? beijingTodayYmd(value) : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || new Date(text+'T00:00:00Z').toISOString().slice(0,10)!==text) throw Error('date')
  } catch { throw fail('退款或原付款日期不完整，请人工核对') }
  return text
}
function positiveMoney(value) {
  const n=moneyUnits(value)
  if(n<=0n || n>99999999999999n) throw new AppError('退款金额必须为正四位金额',400,'SUPPLIER_REFUND_INPUT_INVALID')
  return moneyText(n)
}
function quantityUnits(value) {
  const m=/^(\d+)(?:\.(\d*))?$/.exec(String(value ?? ''))
  if(!m || m[2]?.slice(2).replace(/0/g,'')) throw fail('原退货基本量超过两位或不合法')
  const n=BigInt(m[1])*100n+BigInt((m[2]||'').slice(0,2).padEnd(2,'0'))
  if(n<=0n || n>999999999999n) throw fail('原退货基本量不合法')
  return n
}
function exactBody(body,required,optional=[]) {
  if(!body || typeof body!=='object' || Array.isArray(body) || required.some(k=>!Object.hasOwn(body,k)) || Object.keys(body).some(k=>![...required,...optional].includes(k))) throw new AppError('退款参数不完整或包含不允许的字段',400,'SUPPLIER_REFUND_INPUT_INVALID')
}
function createBody(body) {
  exactBody(body,['operationUuid','purchaseReturnId','incomeAccountId','refundDate','amount','allocations'],['remark'])
  if(typeof body.refundDate!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.refundDate)) throw new AppError('请填写真实退款日期',400,'SUPPLIER_REFUND_INPUT_INVALID')
  date(body.refundDate)
  if(!Array.isArray(body.allocations) || !body.allocations.length || body.allocations.length>200) throw new AppError('请选择准确原付款分配',400,'SUPPLIER_REFUND_INPUT_INVALID')
  const allocations=body.allocations.map(item=>{exactBody(item,['entryId','amount']);return{entryId:safeId(item.entryId),amount:positiveMoney(item.amount)}}).sort((a,b)=>a.entryId-b.entryId)
  if(new Set(allocations.map(a=>a.entryId)).size!==allocations.length || allocations.reduce((n,a)=>n+moneyUnits(a.amount),0n)!==moneyUnits(body.amount)) throw new AppError('退款分配重复或合计不等于退款金额',400,'SUPPLIER_REFUND_INPUT_INVALID')
  if(body.remark!==undefined && (typeof body.remark!=='string' || body.remark.length>500)) throw new AppError('备注不合法',400,'SUPPLIER_REFUND_INPUT_INVALID')
  return {operationUuid:uuid(body.operationUuid),purchaseReturnId:safeId(body.purchaseReturnId),incomeAccountId:safeId(body.incomeAccountId),refundDate:body.refundDate,amount:positiveMoney(body.amount),allocations,...(body.remark!==undefined?{remark:body.remark}:{})}
}
function actionBody(body) {
  exactBody(body,['operationUuid'],['reason'])
  if(body.reason!==undefined && (typeof body.reason!=='string' || !body.reason.trim() || body.reason.length>500)) throw new AppError('说明不合法',400,'SUPPLIER_REFUND_INPUT_INVALID')
  return {operationUuid:uuid(body.operationUuid),...(body.reason!==undefined?{reason:body.reason}:{})}
}
function receiveBody(body) {
  exactBody(body,['operationUuid'],['reason','backfillRequest','backfillReason'])
  const {backfillRequest,backfillReason,...action}=body
  const parsed=actionBody(action)
  if(backfillRequest===undefined&&backfillReason===undefined)return parsed
  if(backfillRequest!==true||typeof backfillReason!=='string'||backfillReason.trim().length<4||backfillReason.trim().length>300)throw new AppError('请填写4至300字的跨期补录申请原因',400,'SUPPLIER_REFUND_INPUT_INVALID')
  return {...parsed,backfillRequest:true,backfillReason:backfillReason.trim()}
}
function identity(action,payload,userId,key) {
  const payloadJson=stableJson(payload)
  return{action,payloadJson,payloadHash:fingerprint(payloadJson),userId:safeId(userId),requestKey:requestKey(key),operationUuid:uuid(payload.operationUuid)}
}
module.exports={safeId,uuid,requestKey,stableJson,fingerprint,date,positiveMoney,quantityUnits,createBody,actionBody,receiveBody,identity,fail}
