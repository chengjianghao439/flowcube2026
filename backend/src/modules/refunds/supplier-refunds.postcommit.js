'use strict'
// Only after business commit: real single-source generation, proof and saved result.
// A borrowed caller invokes this boundary only after its outer commit succeeds.
async function afterReceiveCommit(ack,finish) {
  try{
    const complete=typeof finish==='function'?finish:require('./supplier-refunds.accounting').settleReceivedVoucher
    return await complete({...ack})
  }
  catch{return {pending:true}}
}
module.exports={afterReceiveCommit}
