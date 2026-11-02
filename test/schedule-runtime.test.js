import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

test('关闭前端后定时运行仍完成；服务停机错过多周期后只合并补跑一次', { skip: !process.env.GEO_BROWSER_TEST, timeout: 150000 }, async () => {
  let sends=0,child=null,browser=null;
  const provider=http.createServer((req,res)=>{
    if(req.url==='/send'){sends++;res.end('ok');return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<button>新对话</button><div data-testid="chat_input_input"><div class="tiptap" contenteditable="true" style="min-height:40px"></div></div>'+
      '<button data-testid="chat_input_send_button">发送</button><div data-testid="union_message"><div data-testid="receive_message"><div data-testid="message_text_content" id="answer"></div></div><div data-testid="message_action_bar" style="height:20px"></div></div>'+
      '<script>document.querySelector("[data-testid=chat_input_send_button]").onclick=async()=>{await fetch("/send");document.querySelector(".tiptap").innerText="";setTimeout(()=>document.querySelector("#answer").textContent="验收品牌样本回答",300);};</script>');
  });
  await new Promise(done=>provider.listen(0,'127.0.0.1',done));
  const listener=net.createServer();await new Promise(done=>listener.listen(0,'127.0.0.1',done));
  const port=listener.address().port;await new Promise(done=>listener.close(done));
  const root=await mkdtemp(join(tmpdir(),'geo-schedule-runtime-'));
  const base=`http://127.0.0.1:${port}`,providerUrl=`http://127.0.0.1:${provider.address().port}/`;
  const code=`import {PLATFORMS} from './src/browser.js'; PLATFORMS.doubao.url=${JSON.stringify(providerUrl)}; await import('./src/server.js');`;
  const env={...process.env,GEO_PORT:String(port),GEO_HEADLESS:'1',GEO_DB_PATH:join(root,'test.db'),GEO_PROFILE_ROOT:join(root,'profiles'),GEO_RESULTS_ROOT:join(root,'results')};
  const start=()=>spawn(process.execPath,['--input-type=module','-e',code],{cwd:resolve('.'),env,stdio:['ignore','pipe','pipe']});
  const stop=async()=>{if(!child)return;child.kill();await new Promise(done=>child.exitCode!==null?done():child.once('exit',done));child=null;};
  let cookie,taskId;
  async function call(path,payload){
    const response=await fetch(base+path,{method:payload?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:payload?JSON.stringify(payload):undefined});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    assert.ok(response.ok,path+' '+response.status);return response.json();
  }
  async function ready(){for(let i=0;i<100;i++){try{await fetch(base+'/api/bootstrap');return;}catch{}await new Promise(done=>setTimeout(done,100));}throw new Error('测试服务未启动');}
  async function finishedRunCount(expected){
    const until=Date.now()+65000;
    while(Date.now()<until){
      const runs=(await call('/api/runs')).runs.filter(run=>run.task_id===taskId);
      if(runs.length>=expected&&runs.slice(0,expected).every(run=>run.status==='completed'))return runs.slice(0,expected);
      await new Promise(done=>setTimeout(done,300));
    }
    throw new Error('定时批次未在时限内完成');
  }
  try{
    child=start();await ready();
    await call('/api/setup',{username:'schedule-admin',password:'schedule-test-password-123'});
    const {brand}=await call('/api/brands',{name:'验收品牌',category:'演示工具'});
    await call(`/api/brands/${brand.id}/questions`,{questions:[{text:'请介绍验收品牌样本。',kind:'discovery'}]});
    const questions=(await call(`/api/brands/${brand.id}/questions`)).questions;
    const accounts=(await call('/api/platform-accounts')).accounts;
    const account=accounts.find(item=>item.platform==='doubao');assert.ok(account);
    const {task}=await call('/api/tasks',{brandId:brand.id,name:'定时运行验收',accountIds:[account.id],questionIds:[questions[0].id],scheduleType:'daily'});
    taskId=task.id;
    const db=new (await import('node:sqlite')).DatabaseSync(join(root,'test.db'));
    db.prepare('UPDATE tasks SET next_run_at=? WHERE id=?').run(new Date(Date.now()-86400000).toISOString(),taskId);db.close();

    browser=await chromium.launch({channel:'msedge',headless:true});
    const context=await browser.newContext();await context.addCookies([{name:'geo_session',value:cookie.slice(cookie.indexOf('=')+1),url:base}]);
    const page=await context.newPage();await page.goto(base);await page.close();await browser.close();browser=null;
    const first=await finishedRunCount(1);
    assert.equal(first.length,1,'关闭前端后到期任务只启动一批');
    assert.equal(sends,1);
    const firstDetail=await call(`/api/runs/${first[0].id}`);
    assert.equal(firstDetail.run.status,'completed');assert.equal(firstDetail.results.length,1);
    assert.equal(firstDetail.results[0].answer,'验收品牌样本回答');assert.equal(firstDetail.attempts.length,1);

    const missed=new Date(Date.now()-7*86400000).toISOString();
    const beforeRestart=new (await import('node:sqlite')).DatabaseSync(join(root,'test.db'));
    beforeRestart.prepare('UPDATE tasks SET next_run_at=? WHERE id=?').run(missed,taskId);beforeRestart.close();
    await stop();child=start();await ready();
    const afterRestart=await finishedRunCount(2);
    assert.equal(afterRestart.length,2,'错过多个周期后只合并产生一次补跑');
    assert.equal(sends,2);
    const persisted=new (await import('node:sqlite')).DatabaseSync(join(root,'test.db'));
    try{assert.ok(Date.parse(persisted.prepare('SELECT next_run_at FROM tasks WHERE id=?').get(taskId).next_run_at)>Date.now());}
    finally{persisted.close();}
    await new Promise(done=>setTimeout(done,1000));
    assert.equal((await call('/api/runs')).runs.filter(run=>run.task_id===taskId).length,2,'下个计划时间前不重复补跑');
  }finally{
    if(browser)await browser.close();await stop();provider.closeAllConnections();await new Promise(done=>provider.close(done));
  }
});
