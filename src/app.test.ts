import test from "node:test";
import assert from "node:assert/strict";
import type {FacilitatorClient} from "@x402/core/server";
import {createApp} from "./app.ts";
import {PaymentLedger} from "./ledger.ts";

const payTo="addr_test1vqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygxrcya6";
const facilitator:FacilitatorClient={
  getSupported:async()=>({kinds:[{x402Version:2,scheme:"exact",network:"cardano:preprod",extra:{assetTransferMethods:["default"],l1Confirmations:{minimum:0,maximum:20}}}],extensions:[],signers:{"cardano:*":[]}}),
  verify:async()=>({isValid:false,invalidReason:"synthetic_test_rejection"}),
  settle:async()=>{throw new Error("No real payments may occur in this test");},
};
test("public report requires protocol payment; private, malformed and HEAD requests cannot bypass gate",async()=>{
  const ledger=new PaymentLedger(":memory:");
  const app=await createApp({facilitator,payTo,amount:"2000000",ledger,getReport:async id=>id==="published"?{id,title:"Public evidence",content:"Approved report",source:"user-approved",published_at:"2026-10-31"}:null});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  const address=server.address() as {port:number};const base=`http://127.0.0.1:${address.port}`;
  try{
    const unpaid=await fetch(`${base}/v1/reports/published`);
    assert.equal(unpaid.status,402);assert.ok(unpaid.headers.get("PAYMENT-REQUIRED"));
    const requirements=JSON.parse(Buffer.from(unpaid.headers.get("PAYMENT-REQUIRED")!,"base64").toString());
    assert.equal(requirements.accepts[0].network,"cardano:preprod");
    assert.equal(requirements.accepts[0].amount,"2000000");
    assert.equal((await fetch(`${base}/v1/reports/private`)).status,404);
    assert.equal((await fetch(`${base}/v1/reports/published`,{method:"HEAD"})).status,405);
    assert.equal((await fetch(`${base}/v1/reports/published?other=1`)).status,400);
    assert.equal((await fetch(`${base}/v1/reports/published`,{headers:{"PAYMENT-SIGNATURE":"not-a-proof"}})).status,402);
  }finally{server.close();ledger.close();}
});

test("settled receipts are replay-safe, persist the purchased snapshot and never return data on settlement failure",async()=>{
  const ledger=new PaymentLedger(":memory:");let settlements=0;let allowSettlement=false;
  const transactionHash="36fdff68dfe3660f1ceea60f018a0fd7a83da13def229108794c397a879b0436";
  const simulated:FacilitatorClient={...facilitator,verify:async()=>({isValid:true}),settle:async()=>{
    settlements++;return {success:allowSettlement,transaction:transactionHash,network:"cardano:preprod",...(!allowSettlement?{errorReason:"synthetic_failure"}:{})};
  }};
  const app=await createApp({facilitator:simulated,payTo,amount:"2000000",ledger,getReport:async id=>({id,title:"Public evidence",content:"Approved report",source:"user-approved",published_at:"2026-10-31"})});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try{
    const challenge=await fetch(`${base}/v1/reports/published`);
    const required=JSON.parse(Buffer.from(challenge.headers.get("PAYMENT-REQUIRED")!,"base64").toString());
    // Synthetic unsigned CBOR only exercises our gateway; the injected facilitator is a test double.
    const payload={x402Version:2,resource:required.resource,accepted:required.accepts[0],payload:{transaction:Buffer.from("84a3008001800200a0f5f6","hex").toString("base64"),nonce:"synthetic-test"}};
    const headers={"PAYMENT-SIGNATURE":Buffer.from(JSON.stringify(payload)).toString("base64")};
    const failed=await fetch(`${base}/v1/reports/published`,{headers});
    assert.equal(failed.status,402);assert.equal((await failed.json()).paid,false);
    allowSettlement=true;
    const paid=await fetch(`${base}/v1/reports/published`,{headers});
    assert.equal(paid.status,200);assert.ok(paid.headers.get("PAYMENT-RESPONSE"));
    const result=await paid.json();assert.equal(result.report.id,"published");assert.equal(result.payment.transactionHash,transactionHash);
    const replay=await fetch(`${base}/v1/reports/published`,{headers});assert.equal(replay.status,200);assert.deepEqual(await replay.json(),result);
    assert.equal(settlements,2,"successful retry must not submit a transaction again");
    assert.equal((await fetch(`${base}/v1/reports/another`,{headers})).status,402);
  }finally{server.close();ledger.close();}
});

test("an unconfigured merchant never creates a payment challenge",async()=>{
  const ledger=new PaymentLedger(":memory:");
  const app=await createApp({facilitator,payTo:"",amount:"2000000",ledger,getReport:async()=>null});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  try{const response=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/v1/reports/published`);assert.equal(response.status,503);assert.equal(response.headers.get("PAYMENT-REQUIRED"),null);}
  finally{server.close();ledger.close();}
});
