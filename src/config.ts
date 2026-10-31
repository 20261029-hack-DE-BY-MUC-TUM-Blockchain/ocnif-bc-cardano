import {addressCredentials} from "@x402/cardano";

export function configFromEnv(env:NodeJS.ProcessEnv=process.env){
  const required=(name:string)=>{const value=env[name]?.trim();if(!value)throw new Error(`${name} is required`);return value;};
  const payTo=env.CARDANO_PAY_TO?.trim()??"";
  if(payTo){if(!payTo.startsWith("addr_test1"))throw new Error("Merchant wallet must use a Cardano testnet address");addressCredentials(payTo);}
  const amount=required("CARDANO_PRICE_LOVELACE");
  if(!/^[1-9]\d*$/.test(amount))throw new Error("Invalid CARDANO_PRICE_LOVELACE");
  const port=Number(required("PORT"));if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid PORT");
  const token=required("INTERNAL_TOKEN");if(token.length<32)throw new Error("INTERNAL_TOKEN must contain at least32 characters");
  const facilitator=new URL(required("CARDANO_FACILITATOR_URL"));
  if(facilitator.protocol!=="https:")throw new Error("Facilitator must use HTTPS");
  return {payTo,amount,port,host:required("HOST"),token,facilitator:facilitator.href,backend:required("BACKEND_URL").replace(/\/$/,""),database:required("PAYMENTS_DATABASE_PATH")};
}
