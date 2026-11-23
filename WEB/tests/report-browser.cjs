const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('../../APP/node_modules/jsdom');
const source=fs.readFileSync(require('node:path').join(__dirname,'../resources/js/report-access.js'),'utf8');
const secret='a'.repeat(64);
function windowAt(url,stored){
 const dom=new JSDOM(`<meta name="csrf-token" content="csrf"><div class="page-wrap"><form data-report-unlock action="/reports/unlock"><input name="password" value="sample"><button type="submit">Unlock</button></form><p id="report-unlock-error"></p></div><script data-report-session data-user="1" data-reports-url="https://example.test/reports"></script>`,{url,runScripts:'outside-only'});
 if(stored)dom.window.sessionStorage.setItem('sentinel.report.window.1',stored);
 return dom;
}
const wait=()=>new Promise(r=>setTimeout(r,15));
test('new tab does not reuse account cookies as report authorization',async()=>{
 const dom=windowAt('https://example.test/reports');let calls=0;dom.window.fetch=async()=>{calls++;};dom.window.eval(source);await wait();assert.equal(calls,0);assert.ok(dom.window.document.querySelector('[data-report-unlock]'));dom.window.close();
});
test('same tab resumes reports and puts its token in POST bodies, never URLs',async()=>{
 const dom=windowAt('https://example.test/reports',secret);let sent;
 dom.window.fetch=async(url,options)=>{sent={url,options};return {ok:true,text:async()=>'<div class="page-wrap"><form action="/reports/pdf" method="POST"><button>Download</button></form></div>'}};
 dom.window.eval(source);await wait();assert.equal(sent.options.headers['X-Report-Window'],secret);assert.equal(sent.url.includes(secret),false);
 const form=dom.window.document.querySelector('form');form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));assert.equal(form.querySelector('[name="_report_window_token"]').value,secret);
 dom.window.close();
});
test('password confirmation stores only the opaque tab token and clears the password',async()=>{
 const dom=windowAt('https://example.test/reports');let calls=0;
 dom.window.fetch=async()=>++calls===1?{ok:true,json:async()=>({token:secret})}:{ok:true,text:async()=>'<div class="page-wrap"><h1>Report studio</h1></div>'};
 dom.window.eval(source);const input=dom.window.document.querySelector('[name=password]');dom.window.document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait();await wait();
 assert.equal(dom.window.sessionStorage.getItem('sentinel.report.window.1'),secret);assert.equal(input.value,'');assert.equal(dom.window.localStorage.length,0);assert.match(dom.window.document.querySelector('.page-wrap').textContent,/Report studio/);dom.window.close();
});
test('invalidated tab authorization is discarded and password prompt stays visible',async()=>{
 const dom=windowAt('https://example.test/reports',secret);dom.window.fetch=async()=>({ok:true,text:async()=>'<div class="page-wrap"><form data-report-unlock></form></div>'});dom.window.eval(source);await wait();assert.equal(dom.window.sessionStorage.getItem('sentinel.report.window.1'),null);assert.ok(dom.window.document.querySelector('[data-report-unlock]'));dom.window.close();
});
test('closing or reloading the page clears its token and requests server revocation',()=>{
 const dom=windowAt('https://example.test/completed',secret);let beacon;
 dom.window.navigator.sendBeacon=(url,data)=>{beacon={url,data};return true};dom.window.eval(source);
 dom.window.dispatchEvent(new dom.window.Event('pagehide'));
 assert.equal(dom.window.sessionStorage.getItem('sentinel.report.window.1'),null);assert.equal(beacon.data.get('_report_window_token'),secret);assert.equal(beacon.url,'https://example.test/reports/lock');dom.window.close();
});
