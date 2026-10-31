import {DatabaseSync} from "node:sqlite";
import {mkdirSync} from "node:fs";
import {dirname} from "node:path";
import type {VerifyResponse,SettleResponse} from "@x402/core/types";

interface Row { operation:string; fingerprint:string; verification:string; settlement:string|null; result:string|null }
export class PaymentLedger {
  private database:DatabaseSync;
  constructor(path:string) {
    if(path!==":memory:") mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.database=new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS payments (transaction_id TEXT PRIMARY KEY, operation TEXT NOT NULL, fingerprint TEXT NOT NULL, verification TEXT NOT NULL, settlement TEXT, result TEXT)");
  }
  private row(transaction:string):Row|undefined { return this.database.prepare("SELECT * FROM payments WHERE transaction_id=?").get(transaction) as unknown as Row|undefined; }
  claim(transaction:string,operation:string,fingerprint:string,verification:VerifyResponse):void {
    if(!verification.isValid) throw new Error("unverified_payment");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const previous=this.row(transaction);
      if(previous && previous.operation!==operation) throw new Error("payment_replay");
      if(previous && previous.fingerprint!==fingerprint) throw new Error("payment_changed");
      if(!previous) this.database.prepare("INSERT INTO payments(transaction_id,operation,fingerprint,verification) VALUES(?,?,?,?)").run(transaction,operation,fingerprint,JSON.stringify(verification));
      this.database.exec("COMMIT");
    }catch(error){this.database.exec("ROLLBACK");throw error;}
  }
  verified(transaction:string,operation:string,fingerprint:string):VerifyResponse|undefined {
    const row=this.row(transaction);
    return row?.operation===operation && row.fingerprint===fingerprint?JSON.parse(row.verification):undefined;
  }
  settled(transaction:string,result:SettleResponse):void {
    if(!result.success || result.network!=="cardano:preprod" || result.transaction!==transaction || !this.row(transaction)) throw new Error("invalid_settlement");
    this.database.prepare("UPDATE payments SET settlement=? WHERE transaction_id=?").run(JSON.stringify(result),transaction);
  }
  receipt(transaction:string,operation?:string):SettleResponse|undefined {
    const row=this.row(transaction);
    return row?.settlement && (!operation || row.operation===operation)?JSON.parse(row.settlement):undefined;
  }
  result(transaction:string,create:()=>unknown):unknown {
    const row=this.row(transaction);if(!row)throw new Error("unverified_payment");
    if(row.result)return JSON.parse(row.result);
    const result=create();this.database.prepare("UPDATE payments SET result=? WHERE transaction_id=?").run(JSON.stringify(result),transaction);return result;
  }
  close():void {this.database.close();}
}
