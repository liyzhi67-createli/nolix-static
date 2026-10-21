// No dependencies or bundled credentials. Secrets are provided by the runtime.
// Basic image CAPTCHA deters automated spam; not a risk-scored anti-bot service.
const base=Deno.env.get('SUPABASE_URL')!;
const secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const publicKey=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY')!;
const allowedOrigins=new Set(['https://nolix.us.ci','https://liyzhi67-createli.github.io','http://127.0.0.1:4173','http://localhost:4173']);
const digits=[['01110','11011','11011','11011','11011','11011','01110'],['00100','01100','00100','00100','00100','00100','01110'],['01110','11011','00011','00110','01100','11000','11111'],['11110','00011','00011','01110','00011','00011','11110'],['00011','00111','01111','11011','11111','00011','00011'],['11111','11000','11000','11110','00011','00011','11110'],['01110','11000','11000','11110','11011','11011','01110'],['11111','00011','00110','00110','01100','01100','01100'],['01110','11011','11011','01110','11011','11011','01110'],['01110','11011','11011','01111','00011','00011','01110']];
function random(max:number){const a=new Uint32Array(1);crypto.getRandomValues(a);const limit=Math.floor(0x100000000/max)*max;return a[0]<limit?a[0]%max:random(max)}
async function hash(id:string,answer:string){const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id+':'+answer));return Array.from(new Uint8Array(data),n=>n.toString(16).padStart(2,'0')).join('')}
function image(answer:string){
 let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 80"><rect width="250" height="80" fill="#f4f5ee"/>';
 for(let n=0;n<60;n++)svg+=`<circle cx="${random(250)}" cy="${random(80)}" r="${1+random(2)}" fill="#7c8a6c" opacity=".3"/>`;
 [...answer].forEach((digit,i)=>{let path='';digits[Number(digit)].forEach((row,y)=>[...row].forEach((cell,x)=>{if(cell==='1')path+=`M${x*4} ${y*6}h4v6h-4z`}));svg+=`<path d="${path}" fill="${['#263c25','#233d47','#453425'][random(3)]}" transform="translate(${15+i*38+random(5)} ${17+random(8)}) rotate(${random(19)-9} 10 21) skewX(${random(13)-6})"/>`});
 for(let n=0;n<5;n++)svg+=`<path d="M0 ${random(80)} Q${60+random(120)} ${random(80)} 250 ${random(80)}" fill="none" stroke="#74836b" stroke-width="1.3" opacity=".65"/>`;
 return 'data:image/svg+xml;base64,'+btoa(svg+'</svg>');
}
async function rpc(name:string,body:unknown){const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:secret,'Content-Type':'application/json',...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('database');return r.json()}
export async function handler(req:Request){
 const origin=req.headers.get('Origin')||'';const cors={'Access-Control-Allow-Origin':allowedOrigins.has(origin)?origin:'https://nolix.us.ci','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
 if(origin&&!allowedOrigins.has(origin))return respond({error_code:'forbidden'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return respond({error_code:'invalid'},405);
 const authorization=req.headers.get('Authorization');if(!authorization?.startsWith('Bearer '))return respond({error_code:'unauthorized'},401);
 try{
  // Validate with Auth on EVERY request. Do not trust caller-supplied user IDs.
  const auth=await fetch(base+'/auth/v1/user',{headers:{apikey:publicKey,Authorization:authorization},signal:AbortSignal.timeout(12000)});
  if(!auth.ok)return respond({error_code:'unauthorized'},401);
  const user=await auth.json();if(!user.id||!user.email||!user.email_confirmed_at)return respond({error_code:'email_not_confirmed'},403);
  const text=await req.text();if(text.length>10000)return respond({error_code:'validation_failed'},400);const data=JSON.parse(text);
  if(data.action==='challenge'){
   const answer=Array.from({length:6},()=>String(random(10))).join(''),id=crypto.randomUUID();
   const result=await rpc('noliz_issue_captcha',{p_id:id,p_user_id:user.id,p_answer_hash:await hash(id,answer)});
   if(result.error_code)return respond(result,429);
   return respond({...result,image:image(answer)});
  }
  if(data.action!=='submit'||data.agree!==true||!/^\d{6}$/.test(data.answer||'')||!/^[0-9a-f-]{36}$/i.test(data.challenge_id||''))return respond({error_code:'validation_failed'},400);
  const fields:any={};for(const key of ['name','url','summary','category','relationship']){if(typeof data[key]!=='string')return respond({error_code:'validation_failed'},400);fields[key]=data[key].trim()}
  if(fields.name.length<2||fields.name.length>80||fields.summary.length<10||fields.summary.length>400||fields.url.length>500||!['设计与创意','开发与工具','学习与知识','生活与效率','独立作品'].includes(fields.category)||!['站长','开发者','获授权代表'].includes(fields.relationship))return respond({error_code:'validation_failed'},400);
  const url=new URL(fields.url);if(url.protocol!=='https:'||url.username||url.password||!url.hostname.includes('.'))return respond({error_code:'validation_failed'},400);fields.url=url.href;
  const result=await rpc('noliz_complete_submission',{p_challenge_id:data.challenge_id,p_user_id:user.id,p_email:user.email,p_answer_hash:await hash(data.challenge_id,data.answer),p_data:fields});
  if(result.error_code)return respond(result,result.error_code==='rate_limited'?429:result.error_code==='duplicate'?409:400);
  return respond(result,201);
 }catch(e){if(e instanceof SyntaxError||e instanceof TypeError)return respond({error_code:'validation_failed'},400);return respond({error_code:'server_error'},503)}
}
Deno.serve(handler);
