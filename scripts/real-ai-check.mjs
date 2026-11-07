// One run of the live help flow and the summary against the real AI, through the HTTP API.
// Needs a Lost server on :3300 with ANTHROPIC_API_KEY set. Costs a fraction of a cent. Usage: node scripts/real-ai-check.mjs
const B = "http://localhost:3300";
class C { constructor(){this.k="";this.c=""} async r(m,p,b){const h={cookie:this.k};if(m!=="GET"){h["x-lost-csrf"]=this.c;h["content-type"]="application/json"}const res=await fetch(B+p,{method:m,headers:h,body:b?JSON.stringify(b):m==="GET"?undefined:"{}"});const s=res.headers.get("set-cookie");if(s)this.k=s.split(";")[0];return res.json()}
 async demo(w){await this.r("POST","/api/auth/demo",{who:w});this.c=(await this.r("GET","/api/me")).csrf;return this}}
const prof=await new C().demo("prof"), jordan=await new C().demo("jordan");
const c=(await prof.r("GET","/api/prof/courses")).courses.find(x=>x.code==="CSC 311");
const d=await prof.r("GET",`/api/prof/courses/${c.id}`);
const s=await prof.r("POST",`/api/prof/courses/${c.id}/sessions`,{sectionId:d.sections[0].id,title:"Error detection"});
await prof.r("POST",`/api/prof/sessions/${s.id}/start`);
const L=["Okay, last time we did single parity: one extra bit so the number of ones is even.","Single parity catches any one flipped bit, but if two bits flip, the count is even again and we miss it.","So today: two-dimensional parity. Put the data bits in a grid, rows and columns.","We compute a parity bit for every row and for every column, plus one corner bit.","Now if one bit flips, exactly one row check fails and exactly one column check fails."];
for(const t of L) await prof.r("POST",`/api/prof/sessions/${s.id}/line`,{text:t,origin:"sample"});
const tap=await jordan.r("POST",`/api/student/sessions/${s.id}/lost`);
let t0=Date.now();
const h=await jordan.r("POST",`/api/student/events/${tap.event.id}/help`,{kind:"explain",anchor:"phrase",line:4,category:"reasoning"});
console.log("explain", h.status, (Date.now()-t0)+"ms", h.error||""); console.log(JSON.stringify(h.payload,null,1).slice(0,2500));
await prof.r("POST",`/api/prof/sessions/${s.id}/line`,{text:"The intersection of that row and that column is the bad bit, so the receiver can flip it back.",origin:"sample"});
await prof.r("POST",`/api/prof/sessions/${s.id}/line`,{text:"Next we'll look at the Internet checksum, which is cheaper but weaker.",origin:"sample"});
t0=Date.now(); const r=await jordan.r("POST",`/api/student/events/${tap.event.id}/help`,{kind:"retry",attempt:1}); console.log("retry",r.status,(Date.now()-t0)+"ms", r.payload?.flow ? JSON.stringify(r.payload.flow):"");
t0=Date.now(); const cu=await jordan.r("POST",`/api/student/events/${tap.event.id}/help`,{kind:"catchup",attempt:1}); console.log("catchup",cu.status,(Date.now()-t0)+"ms",JSON.stringify(cu.payload).slice(0,600));
t0=Date.now(); const q=await jordan.r("POST",`/api/student/events/${tap.event.id}/check`); console.log("check",(Date.now()-t0)+"ms",JSON.stringify(q));
await prof.r("POST",`/api/prof/sessions/${s.id}/end`);
for(let i=0;i<60;i++){const rep=await prof.r("GET",`/api/prof/sessions/${s.id}/report`); if(rep.summary&&rep.summary.status!=="pending"){console.log("summary",rep.summary.status,rep.summary.error||"",JSON.stringify(rep.summary.payload?.shared).slice(0,1500)); console.log("moments",JSON.stringify(rep.analytics.moments)); break;} await new Promise(r=>setTimeout(r,2000));}
console.log(s.id);
