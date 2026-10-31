import {HTTPFacilitatorClient} from "@x402/core/server";
import {createApp,type PublishedReport} from "./app.ts";
import {configFromEnv} from "./config.ts";
import {PaymentLedger} from "./ledger.ts";

const config=configFromEnv();
const ledger=new PaymentLedger(config.database);
const app=await createApp({payTo:config.payTo,amount:config.amount,ledger,facilitator:new HTTPFacilitatorClient({url:config.facilitator}),
  getReport:async(id)=>{
    const response=await fetch(`${config.backend}/internal/reports/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${config.token}`},signal:AbortSignal.timeout(15_000)});
    if(response.status===404)return null;
    if(!response.ok)throw new Error("report_service_unavailable");
    return await response.json() as PublishedReport;
  }});
const server=app.listen(config.port,config.host);
process.on("SIGTERM",()=>server.close(()=>{ledger.close();process.exit(0);}));
