interface Env {
  ENGINE: Fetcher;
  BILLING: Fetcher;
  AUTH: Fetcher;
  RAZORPAY_SUBSCRIPTION_URL?: string;
  PUBLIC_APP_ORIGIN?: string;
}

const baseHeaders = {
  "access-control-allow-headers": "content-type,x-api-key,authorization,x-admin-secret,x-razorpay-signature,x-razorpay-event-id",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};
function requestId(){return `req_${crypto.randomUUID().replaceAll("-","")}`;}
function corsHeaders(env:Env,origin:string|null):Record<string,string>{const configured=String(env.PUBLIC_APP_ORIGIN??"https://therandomhuman-hub.github.io").split(",").map(x=>x.trim()).filter(Boolean);return origin&&configured.includes(origin)?{...baseHeaders,"access-control-allow-origin":origin,"access-control-allow-credentials":"true",vary:"Origin"}:{...baseHeaders};}
function json(env:Env,origin:string|null,body:unknown,status=200,headers:HeadersInit={}){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8",...corsHeaders(env,origin),...headers}});}
function queryError(env:Env,origin:string|null,message:string,id:string){return json(env,origin,{error:{code:"INVALID_QUERY",message,request_id:id}},400,{"x-request-id":id});}
function validateMomentumQuery(url:URL):string|null{
  const language=url.searchParams.get("language")??"";
  const minStars=Number(url.searchParams.get("min_stars")??100);
  const maxAge=Number(url.searchParams.get("max_age_days")??3650);
  const limit=Number(url.searchParams.get("limit")??5);
  if(language.length>64||/[\u0000-\u001f]/.test(language)) return "language is invalid";
  if(!Number.isInteger(minStars)||minStars<0||minStars>1_000_000)return "min_stars must be an integer from 0 to 1000000";
  if(!Number.isInteger(maxAge)||maxAge<1||maxAge>36_500)return "max_age_days must be an integer from 1 to 36500";
  if(!Number.isInteger(limit)||limit<1||limit>20)return "limit must be an integer from 1 to 20";
  return null;
}

export default {async fetch(request:Request,env:Env):Promise<Response>{
  const id=requestId(),url=new URL(request.url),origin=request.headers.get("origin");
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders(env,origin)});
  const authPaths=["/auth/config","/auth/google","/auth/me","/auth/logout"];
  const isAuth=authPaths.includes(url.pathname),isCustomerProvisioning=url.pathname==="/internal/customers",isRazorpayWebhook=url.pathname==="/webhooks/razorpay",isBillingClaim=url.pathname==="/billing/claim",isBillingHealth=url.pathname==="/billing/health",isAuthHealth=url.pathname==="/auth/health",isCheckout=url.pathname==="/billing/checkout",isMomentum=url.pathname==="/v1/momentum";
  const isAllowedPost=(isAuth&&request.method==="POST")||((isCustomerProvisioning||isRazorpayWebhook||isBillingClaim||isCheckout)&&request.method==="POST");
  if(request.method!=="GET"&&!isAllowedPost)return json(env,origin,{error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed",request_id:id}},405,{allow:"GET,POST,OPTIONS","x-request-id":id});
  if(isMomentum&&request.method==="GET"){const problem=validateMomentumQuery(url);if(problem)return queryError(env,origin,problem,id);}
  if(url.pathname==="/health")return json(env,origin,{status:"ok",service:"momentum-api-public",engine:"service-binding",billing:"service-binding",auth:"service-binding"},200,{"x-request-id":id});
  if(url.pathname==="/version")return json(env,origin,{name:"Momentum API",version:"2.1.0",engine:"1.3.1",billing:"1.3.1",auth:"1.2.0"},200,{"x-request-id":id});
  if(isBillingHealth&&request.method==="GET"){
    const headers=new Headers(request.headers);headers.set("x-request-id",id);
    try{const probeUrl=new URL("/health",request.url),response=await env.BILLING.fetch(new Request(probeUrl.toString(),{method:"GET",headers,signal:AbortSignal.timeout(5000)})),outHeaders=new Headers(response.headers);outHeaders.set("x-request-id",id);for(const[k,v]of Object.entries(corsHeaders(env,origin)))outHeaders.set(k,v);return new Response(response.body,{status:response.status,headers:outHeaders});}
    catch(error){console.error(JSON.stringify({event:"billing_binding_health_failed",request_id:id,error:String(error)}));return json(env,origin,{error:{code:"BILLING_BINDING_UNAVAILABLE",message:"Billing service is unavailable",request_id:id}},503,{"x-request-id":id});}
  }
  if(isAuthHealth&&request.method==="GET"){
    const headers=new Headers(request.headers);headers.set("x-request-id",id);
    try{const probeUrl=new URL("/health",request.url),response=await env.AUTH.fetch(new Request(probeUrl.toString(),{method:"GET",headers,signal:AbortSignal.timeout(5000)})),outHeaders=new Headers(response.headers);outHeaders.set("x-request-id",id);for(const[k,v]of Object.entries(corsHeaders(env,origin)))outHeaders.set(k,v);return new Response(response.body,{status:response.status,headers:outHeaders});}
    catch(error){console.error(JSON.stringify({event:"auth_binding_health_failed",request_id:id,error:String(error)}));return json(env,origin,{error:{code:"AUTH_BINDING_UNAVAILABLE",message:"Authentication service is unavailable",request_id:id}},503,{"x-request-id":id});}
  }
  if(isCheckout&&request.method==="GET"){
    const target=env.RAZORPAY_SUBSCRIPTION_URL;if(!target)return json(env,origin,{error:{code:"BILLING_NOT_CONFIGURED",message:"Pro checkout is not configured",request_id:id}},503,{"x-request-id":id});
    try{const u=new URL(target);if(u.protocol!=="https:"||!["rzp.io","pages.razorpay.com"].includes(u.hostname))throw new Error("invalid checkout URL");}catch{return json(env,origin,{error:{code:"BILLING_NOT_CONFIGURED",message:"Pro checkout URL is invalid",request_id:id}},503,{"x-request-id":id});}
    return new Response(null,{status:302,headers:{Location:target,"cache-control":"no-store","x-request-id":id,...corsHeaders(env,origin)}});
  }
  if(!url.pathname.startsWith("/v1/")&&!isAuth&&!isCustomerProvisioning&&!isRazorpayWebhook&&!isBillingClaim&&!isBillingHealth&&!isAuthHealth&&!isCheckout)return json(env,origin,{error:{code:"NOT_FOUND",message:"Route not found",request_id:id}},404,{"x-request-id":id});
  const headers=new Headers(request.headers);headers.set("x-request-id",id);const upstreamRequest=new Request(url.toString(),{method:request.method,headers,body:request.method==="GET"?undefined:request.body,signal:AbortSignal.timeout(8000)});
  try{let binding=env.ENGINE;if(isAuth)binding=env.AUTH;else if(isRazorpayWebhook||isBillingClaim||isCheckout)binding=env.BILLING;const response=await binding.fetch(upstreamRequest),outHeaders=new Headers(response.headers);outHeaders.set("x-request-id",id);for(const[k,v]of Object.entries(corsHeaders(env,origin)))outHeaders.set(k,v);return new Response(response.body,{status:response.status,headers:outHeaders});}
  catch(error){console.error(JSON.stringify({event:"service_binding_failed",path:url.pathname,request_id:id,error:String(error)}));return json(env,origin,{error:{code:"UPSTREAM_UNAVAILABLE",message:"Momentum service unavailable",request_id:id}},503,{"x-request-id":id});}
}};
// Release 2.1.0: schema-first query validation plus explicit AUTH/BILLING binding health probes.
