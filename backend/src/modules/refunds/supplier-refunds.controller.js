'use strict'
const service=require('./supplier-refunds.service')
const {successResponse}=require('../../utils/response')
const {extractRequestKey}=require('../../utils/requestKey')
function handle(fn){return async(req,res,next)=>{try{return successResponse(res,await fn(req),'操作成功')}catch(error){next(error)}}}
const options=req=>({userId:req.user?.userId,requestKey:extractRequestKey(req)})
module.exports={
 source:handle(req=>service.getSource(req.query.purchaseReturnId,req.user?.userId)),
 list:handle(req=>service.findAll(req.query,req.user?.userId)),
 detail:handle(req=>service.findById(req.params.id,req.user?.userId)),
 backfillApplication:handle(req=>service.lookupBackfillApplication(req.params.uuid,req.query,req.user?.userId)),
 own:handle(req=>service.getOwnOperation(req.params.uuid,req.query,req.user?.userId)),
 create:handle(req=>service.create(req.body,options(req))),
 confirm:handle(req=>service.confirm(req.params.id,req.body,options(req))),
 regenerateVoucher:handle(req=>service.regenerateVoucher(req.params.id,req.user?.userId)),
 receive:handle(req=>{const {backfillRequest,backfillReason,...body}=req.body;return service.receive(req.params.id,body,{...options(req),backfillRequest,backfillReason})}),
 cancel:handle(req=>service.cancel(req.params.id,req.body,options(req))),
}
