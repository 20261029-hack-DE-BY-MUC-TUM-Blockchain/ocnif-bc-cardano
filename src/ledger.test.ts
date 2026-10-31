import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PaymentLedger} from "./ledger.ts";

test("verified payments stay bound to one report and exact proof across restarts", () => {
  const directory=mkdtempSync(join(tmpdir(),"ocnif-payments-"));
  const path=join(directory,"ledger.sqlite");
  let ledger=new PaymentLedger(path);
  ledger.claim("tx-1","report-1","fingerprint-1",{isValid:true});
  assert.throws(()=>ledger.claim("tx-1","report-2","fingerprint-1",{isValid:true}),/payment_replay/);
  assert.throws(()=>ledger.claim("tx-1","report-1","modified",{isValid:true}),/payment_changed/);
  ledger.settled("tx-1",{success:true,transaction:"tx-1",network:"cardano:preprod"});
  ledger.close();ledger=new PaymentLedger(path);
  assert.equal(ledger.verified("tx-1","report-1","fingerprint-1")?.isValid,true);
  assert.equal(ledger.receipt("tx-1","report-1")?.transaction,"tx-1");
  assert.equal(ledger.receipt("tx-1","report-2"),undefined);
  ledger.close();rmSync(directory,{recursive:true});
});
test("unverified, unsuccessful or wrong-network evidence cannot become paid",()=>{
  const ledger=new PaymentLedger(":memory:");
  assert.throws(()=>ledger.claim("x","r","f",{isValid:false}),/unverified/);
  ledger.claim("x","r","f",{isValid:true});
  assert.throws(()=>ledger.settled("x",{success:false,transaction:"x",network:"cardano:preprod"}),/invalid_settlement/);
  assert.throws(()=>ledger.settled("x",{success:true,transaction:"x",network:"cardano:mainnet"}),/invalid_settlement/);
  ledger.close();
});
