const assert = require('node:assert/strict');
const http = require('node:http');

function request(port, method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({ hostname:'127.0.0.1', port, path:route, method, headers:{Accept:'application/json',...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{})}}, res => {
      let data=''; res.setEncoding('utf8'); res.on('data',x=>data+=x); res.on('end',()=>{ let parsed=data; try{parsed=JSON.parse(data)}catch(_){} resolve({status:res.statusCode,body:parsed}); });
    });
    req.on('error',reject); if(payload)req.write(payload); req.end();
  });
}
(async()=>{
  const port=Number(process.env.PORT||5001); process.env.PORT=String(port);
  const {startFullInvestigationJob,getFullInvestigationJob}=require('./full-pipeline');
  const job=startFullInvestigationJob({latitude:28.28,longitude:73.73,timestamp:new Date().toISOString(),tenderId:null,photo:null,accuracy:8,objectHint:'road work',department:'PWD'});
  assert.ok(job.jobId);
  const before=getFullInvestigationJob(job.jobId); assert.equal(before.status,'running');
  const {server}=require('./app');
  const response=await request(port,'GET',`/api/investigation-jobs/${encodeURIComponent(job.jobId)}`);
  assert.equal(response.status,200); assert.equal(response.body.jobId,job.jobId); assert.equal(response.body.status,'running');
  if(server?.listening) await new Promise(r=>server.close(r));
  console.log(JSON.stringify({status:'success',jobId:job.jobId,initialStageCount:response.body.stages.length},null,2));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
