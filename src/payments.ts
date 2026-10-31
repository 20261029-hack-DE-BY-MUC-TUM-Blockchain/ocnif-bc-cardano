import {createHash} from "node:crypto";
import {decodeCardanoTransaction} from "@x402/cardano";
import {x402ResourceServer,type FacilitatorClient,type VerifyContext,type HTTPTransportContext} from "@x402/core/server";
import {ExactCardanoScheme} from "@x402/cardano/exact/server";
import {PaymentLedger} from "./ledger.ts";

function identity(context:VerifyContext) {
  const transaction=decodeCardanoTransaction(String(context.paymentPayload.payload.transaction)).txHash;
  const request=(context.transportContext as HTTPTransportContext).request;
  const operation=new URL(request.adapter.getUrl()).pathname.split("/").at(-1)!;
  const fingerprint=createHash("sha256").update(JSON.stringify([context.paymentPayload,context.requirements])).digest("hex");
  return {transaction,operation,fingerprint};
}
export function paymentServer(facilitator:FacilitatorClient,ledger:PaymentLedger) {
  const persistent:FacilitatorClient={
    getSupported:()=>facilitator.getSupported(),
    verify:(payload,requirements)=>facilitator.verify(payload,requirements),
    settle:async(payload,requirements)=>{
      const transaction=decodeCardanoTransaction(String(payload.payload.transaction)).txHash;
      const cached=ledger.receipt(transaction);if(cached)return cached;
      const result=await facilitator.settle(payload,requirements);
      if(result.success)ledger.settled(transaction,result);
      return result;
    },
  };
  const server=new x402ResourceServer(persistent).register("cardano:preprod",new ExactCardanoScheme());
  server.onBeforeVerify(async context=>{
    try { const id=identity(context);const result=ledger.verified(id.transaction,id.operation,id.fingerprint);if(result)return {skip:true,result}; }
    catch { return {abort:true,reason:"invalid_payment_operation"}; }
  });
  server.onAfterVerify(async context=>{
    if(!context.result.isValid)return;
    try {const id=identity(context);ledger.claim(id.transaction,id.operation,id.fingerprint,context.result);}
    catch {return {abort:true,reason:"payment_replay_or_storage_failure"};}
  });
  return server;
}
