interface Env{DB:D1Database;RAZORPAY_WEBHOOK_SECRET?:string;RAZORPAY_STARTER_PLAN_ID?:string;RAZORPAY_PRO_PLAN_ID?:string}
type Sub={id?:string;plan_id?:string;customer_id?:string;status?:string;current_start?:number|null;current_end?:number|null;ended_at?:number|null;notes?:Record<string,unknown>|unknown[]}
type Event={event?:string;created_at?:number;payload?:{subscription?:{entity?:Sub}}}
const json=(body:unknown,status=200,h:HeadersInit={})=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8",...h}})
const rid=()=>`req_${crypto.randomUUID().replaceAll("-","")}`
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("")
async function hmac(secret:string,body:string){const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return hex(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(body)))}
const eq=(a:string,b:string)=>{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
const isSub=(e:string)=>e.startsWith("subscription.")
const isActive=(e:string)=>e==="subscription.activated"||e==="subscription.resumed"
const isHealthyBilling=(e:string)=>isActive(e)||e==="subscription.charged"
const isSuspend=(e:string)=>e==="subscription.paused"||e==="subscription.pending"||e==="subscription.halted"
const isTerminal=(e:string)=>e==="subscription.cancelled"||e==="subscription.completed"||e==="subscription.expired"
const isCreate=(e:string)=>e==="subscription.created"
const isPre=(e:string)=>e==="subscription.authenticated"
function tierFor(env:Env,id:string):"starter"|"pro"|null{if(env.RAZORPAY_STARTER_PLAN_ID&&id===env.RAZORPAY_STARTER_PLAN_ID)return"starter";if(env.RAZORPAY_PRO_PLAN_ID&&id===env.RAZORPAY_PRO_PLAN_ID)return"pro";return null}
async function mark(env:Env,eventId:string,status:string,error_message:string|null=null){await env.DB.prepare("UPDATE razorpay_webhook_events SET status=?,processed_at=?,error_message=? WHERE event_id=?").bind(status,new Date().toISOString(),error_message,eventId).run()}
async function syncCustomer(env:Env,customer:string,tier:"free"|"starter"|"pro",active=true){await env.DB.prepare("UPDATE customers SET tier=?,monthly_quota=(SELECT monthly_quota FROM plans WHERE tier=? AND active=1),rate_limit_per_minute=(SELECT rate_limit_per_minute FROM plans WHERE tier=? AND active=1),active=? WHERE id=?").bind(tier,tier,tier,active?1:0,customer).run()}
async function process(env:Env,eventId:string,event:Event){
 const et=String(event.event??"unknown");
 if(!isSub(et)){await mark(env,eventId,"ignored");return}
 const s=event.payload?.subscription?.entity;if(!s?.id)throw new Error("Missing subscription entity id");
 const sid=s.id,pid=String(s.plan_id??""),rpc=s.customer_id?String(s.customer_id):null,notes=s.notes&&!Array.isArray(s.notes)?s.notes:{} as Record<string,unknown>,t=Number(event.created_at??0);
 const ex=await env.DB.prepare("SELECT customer_id,tier,status,updated_at,last_event_created_at,is_current FROM razorpay_subscriptions WHERE subscription_id=? LIMIT 1").bind(sid).first<{customer_id:string;tier:string;status:string;updated_at:string;last_event_created_at:number|null;is_current:number}>();
 const noted=typeof notes.momentum_customer_id==="string"?notes.momentum_customer_id:null;
 const customer=ex?.customer_id??noted;
 if(isCreate(et)&&!customer){await mark(env,eventId,"processed");return}
 if(isPre(et)&&!customer){await mark(env,eventId,"processed");return}
 if(!customer)throw new Error("Missing momentum_customer_id mapping");
 if(t>0&&ex?.last_event_created_at!=null&&t<ex.last_event_created_at){await mark(env,eventId,"ignored");return}
 const current=await env.DB.prepare("SELECT subscription_id,tier,status,last_event_created_at FROM razorpay_subscriptions WHERE customer_id=? AND is_current=1 LIMIT 1").bind(customer).first<{subscription_id:string;tier:string;status:string;last_event_created_at:number|null}>();
 const currentTime=current?.last_event_created_at??0;
 if(t>0&&current&&current.subscription_id!==sid&&currentTime>0&&t<currentTime){await mark(env,eventId,"ignored");return}
 const mapped=tierFor(env,pid);
 let tier:"free"|"starter"|"pro"|null=null;
 if(isActive(et)||et==="subscription.charged"||et==="subscription.updated")tier=mapped;
 if(isSuspend(et))tier=mapped??(ex&&["starter","pro"].includes(ex.tier)?ex.tier as "starter"|"pro":null);
 if(isTerminal(et))tier="free";
 if(isCreate(et)||isPre(et))tier=mapped??(ex&&["starter","pro"].includes(ex.tier)?ex.tier as "starter"|"pro":null);
 if((isActive(et)||et==="subscription.charged"||et==="subscription.updated")&&!tier)throw new Error("Unknown Razorpay plan id");
 const claimCurrent=(isActive(et)||et==="subscription.charged"||et==="subscription.updated")&&(!current||current.subscription_id===sid||t>=currentTime);
 if(claimCurrent&&current?.subscription_id!==sid)await env.DB.prepare("UPDATE razorpay_subscriptions SET is_current=0 WHERE customer_id=? AND is_current=1").bind(customer).run();
 const suspended=isSuspend(et)?new Date().toISOString():null;
 const ended=isTerminal(et)?(s.ended_at??Math.floor(Date.now()/1000)):null;
 const now=new Date().toISOString();
 const rowTier=tier??ex?.tier??"unknown";
 const rowCurrent=claimCurrent||ex?.is_current===1?1:0;
 await env.DB.prepare("INSERT INTO razorpay_subscriptions(subscription_id,customer_id,razorpay_customer_id,plan_id,tier,status,current_start,current_end,created_at,updated_at,last_event_created_at,is_current,suspended_at,ended_at,last_event_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET customer_id=excluded.customer_id,razorpay_customer_id=COALESCE(excluded.razorpay_customer_id,razorpay_subscriptions.razorpay_customer_id),plan_id=COALESCE(excluded.plan_id,razorpay_subscriptions.plan_id),tier=excluded.tier,status=excluded.status,current_start=COALESCE(excluded.current_start,razorpay_subscriptions.current_start),current_end=COALESCE(excluded.current_end,razorpay_subscriptions.current_end),updated_at=excluded.updated_at,last_event_created_at=CASE WHEN excluded.last_event_created_at IS NOT NULL THEN excluded.last_event_created_at ELSE razorpay_subscriptions.last_event_created_at END,is_current=excluded.is_current,suspended_at=excluded.suspended_at,ended_at=COALESCE(excluded.ended_at,razorpay_subscriptions.ended_at),last_event_id=excluded.last_event_id").bind(sid,customer,rpc,pid,rowTier,String(s.status??et),s.current_start??null,s.current_end??null,now,now,t>0?t:null,rowCurrent,suspended,ended,eventId).run();
 if(isTerminal(et)&&rowCurrent===1){await env.DB.prepare("UPDATE razorpay_subscriptions SET is_current=0 WHERE subscription_id=?").bind(sid).run();const repl=await env.DB.prepare("SELECT subscription_id,tier FROM razorpay_subscriptions WHERE customer_id=? AND subscription_id<>? AND is_current=1 AND status IN ('active','authenticated') ORDER BY COALESCE(last_event_created_at,0) DESC,updated_at DESC LIMIT 1").bind(customer).first<{subscription_id:string;tier:string}>();if(repl&&["starter","pro"].includes(repl.tier)){await syncCustomer(env,customer,repl.tier as "starter"|"pro");}else await syncCustomer(env,customer,"free",true)}
 else if(isSuspend(et)&&rowCurrent===1){await syncCustomer(env,customer,ex&&["starter","pro"].includes(ex.tier)?ex.tier as "starter"|"pro":"free",false)}
 else if(isActive(et)||et==="subscription.charged"||et==="subscription.updated"){if(rowCurrent===1)await syncCustomer(env,customer,tier as "starter"|"pro",true)}
 await mark(env,eventId,"processed");
}
async function webhook(req:Request,env:Env,id:string){const sec=env.RAZORPAY_WEBHOOK_SECRET;if(!sec)return json({error:{code:"BILLING_NOT_CONFIGURED",message:"Razorpay webhook secret is not configured",request_id:id}},503,{"x-request-id":id});const sig=req.headers.get("x-razorpay-signature")??"",eid=req.headers.get("x-razorpay-event-id")??"",body=await req.text();const want=await hmac(sec,body);if(!sig||!eq(want,sig))return json({error:{code:"INVALID_SIGNATURE",message:"Invalid Razorpay webhook signature",request_id:id}},401,{"x-request-id":id});if(!eid)return json({error:{code:"MISSING_EVENT_ID",message:"Missing x-razorpay-event-id header",request_id:id}},400,{"x-request-id":id});let e:Event;try{e=JSON.parse(body)}catch{return json({error:{code:"INVALID_JSON",message:"Webhook body must be valid JSON",request_id:id}},400,{"x-request-id":id})}const et=String(e.event??"unknown"),ca=Number(e.created_at??0);const payloadHash=hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body)));const existing=await env.DB.prepare("SELECT status,payload_sha256 FROM razorpay_webhook_events WHERE event_id=? LIMIT 1").bind(eid).first<{status:string;payload_sha256:string}>();if(existing){if(existing.payload_sha256!==payloadHash)return json({error:{code:"EVENT_ID_REUSE",message:"Razorpay event id was already used with a different payload",request_id:id}},409,{"x-request-id":id});if(existing.status==="processed"||existing.status==="ignored")return json({status:"ok",duplicate:true,request_id:id},200,{"x-request-id":id});}
 await env.DB.prepare("INSERT OR IGNORE INTO razorpay_webhook_events(event_id,event_type,status,received_at,payload_sha256) VALUES(?,?,?,?,?)").bind(eid,et,"received",new Date().toISOString(),payloadHash).run();
 try{await process(env,eid,e)}catch(err){const msg=err instanceof Error?err.message:"Webhook processing failed";await mark(env,eid,"failed",msg.slice(0,500));console.error("Razorpay webhook processing failed",err);return json({error:{code:"WEBHOOK_PROCESSING_FAILED",message:"Webhook processing failed; retry the event",request_id:id}},500,{"x-request-id":id})}
 return json({status:"processed",request_id:id},200,{"x-request-id":id})}
export default{async fetch(req:Request,env:Env){const id=rid(),u=new URL(req.url);if(req.method==="OPTIONS")return new Response(null,{status:204});if(u.pathname==="/health"&&req.method==="GET")return json({status:"ok",service:"momentum-billing"},200,{"x-request-id":id});if(u.pathname==="/webhooks/razorpay"&&req.method==="POST")return webhook(req,env,id);return json({error:{code:"NOT_FOUND",message:"Route not found",request_id:id}},404,{"x-request-id":id})}}