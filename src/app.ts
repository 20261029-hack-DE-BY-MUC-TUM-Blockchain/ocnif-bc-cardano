import express from "express";
import {decodeCardanoTransaction} from "@x402/cardano";
import {decodePaymentSignatureHeader} from "@x402/core/http";
import {x402HTTPResourceServer,type FacilitatorClient} from "@x402/core/server";
import {paymentMiddlewareFromHTTPServer} from "@x402/express";
import {PaymentLedger} from "./ledger.ts";
import {paymentServer} from "./payments.ts";

export interface PublishedReport { id:string; title:string; content:string; source:"user-approved"; published_at:string; [key:string]:unknown }
interface Options { facilitator:FacilitatorClient; payTo:string; amount:string; ledger:PaymentLedger; getReport:(id:string)=>Promise<PublishedReport|null> }

export async function createApp(options:Options) {
  const app=express();app.enable("case sensitive routing");app.enable("strict routing");app.disable("x-powered-by");
  app.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
  app.get("/health",(_req,res)=>res.json({status:"ok",service:"ocnif-bc-cardano",configured:Boolean(options.payTo)}));
  app.get("/v1/config",(_req,res)=>res.json({network:"cardano:preprod",configured:Boolean(options.payTo),payTo:options.payTo||null,amount:options.amount,asset:"lovelace",confirmationPolicy:{l1Confirmations:1}}));
  if(!options.payTo){app.use("/v1/reports",(_req,res)=>{res.status(503).json({error:"merchant_wallet_setup_required",paid:false});});return app;}
  const server=paymentServer(options.facilitator,options.ledger);
  const http=new x402HTTPResourceServer(server,{"GET /v1/reports/*":{
    accepts:{scheme:"exact",network:"cardano:preprod",payTo:options.payTo,price:{amount:options.amount,asset:"lovelace"},maxTimeoutSeconds:600,
      extra:{assetTransferMethod:"default",areFeesSponsored:false,confirmationPolicy:{l1Confirmations:1}}},
    description:"User-published cybersecurity evidence report",mimeType:"application/json",
    settlementFailedResponseBody:()=>({contentType:"application/json",body:{error:"payment_not_settled",paid:false}}),
  }});
  await http.initialize();
  app.use(async(req,res,next)=>{
    if(!req.path.startsWith("/v1/reports/"))return next();
    if(req.method!=="GET"){res.set("Allow","GET").status(405).end();return;}
    const match=req.path.match(/^\/v1\/reports\/([A-Za-z0-9_-]{1,100})$/);
    if(!match || Object.keys(req.query).length){res.status(400).json({error:"invalid_report_request"});return;}
    try { const report=await options.getReport(match[1]!);
      if(!report || report.source!=="user-approved" || !report.published_at){res.status(404).json({error:"published_report_not_found"});return;}
      res.locals.report=report;next();
    }catch{res.status(503).json({error:"report_service_unavailable"});}
  });
  app.use(paymentMiddlewareFromHTTPServer(http,undefined,undefined,false));
  app.get("/v1/reports/:id",(req,res)=>{
    const payment=decodePaymentSignatureHeader(req.get("PAYMENT-SIGNATURE")!);
    const transactionHash=decodeCardanoTransaction(String(payment.payload.transaction)).txHash;
    res.json(options.ledger.result(transactionHash,()=>({report:res.locals.report,payment:{transactionHash,network:"cardano:preprod"}})));
  });
  app.use((_error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(503).json({error:"payment_processing_unavailable",paid:false});});
  return app;
}
