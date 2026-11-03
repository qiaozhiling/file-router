const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../main/resources/static/upload.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ui = false, response = () => 200} = {}) {
    const requests = [], nodes = {}, alerts = [];
    function element() {
        return {children: [], events: {}, style: {}, dataset: {}, textContent: '', disabled: false,
            append(...children) { this.children.push(...children); children.forEach(child => child.parent=this); },
            appendChild(child) { this.append(child); },
            remove() { this.parent.children.splice(this.parent.children.indexOf(this),1); },
            addEventListener(name,callback) { this.events[name]=callback; },
            setAttribute() {}, click() { return this.events.click?.(); },
            set innerHTML(value) { throw Error('Unsafe HTML insertion'); }};
    }
    if (ui) for (const id of ['file-upload','picker','file-input','ctlBtn','flist','upload-message']) nodes[id]=element();
    if (ui) nodes['file-upload'].dataset.uploadUrl='/context/upload';
    class XHR {
        constructor() { this.upload={}; this.aborted=false; }
        open(method,url) { this.method=method;this.url=url; }
        send(form) {
            this.form=form;requests.push(this);
            queueMicrotask(async () => {
                this.upload.onprogress({lengthComputable:true,loaded:1,total:2});
                this.upload.onload?.();
                const result=await response(form,requests.filter(r=>r.form.get('chunk')===form.get('chunk') && r.form.get('name')===form.get('name')).length);
                if (this.aborted) return;
                if (result==='network') this.onerror();
                else if (result==='timeout') this.ontimeout();
                else {
                    this.status=typeof result==='object'?result.status:result;
                    const final=form.get('chunk')===null || Number(form.get('chunk'))===Number(form.get('chunks'))-1;
                    this.responseText=typeof result==='object'?result.body:JSON.stringify({status:final?'completed':'chunk_received'});
                    this.onload();
                }
            });
        }
        abort() { this.aborted=true;this.onabort(); }
    }
    const window={addEventListener(name,callback) { this[name]=callback; }};
    vm.runInNewContext(source,{window, document:{getElementById:id=>nodes[id],createElement:element},XMLHttpRequest:XHR, FormData, AbortController, setTimeout:callback=>setImmediate(callback)});
    return {upload:window.FileRouterUpload.upload, requests,nodes,window,alerts};
}
test('single and empty files use the original multipart protocol without chunk fields', async () => {
    for (const contents of ['中文 & + %', '']) {
        const f=fixture(),file=new File([contents],'文件 & + %.txt'),progress=[];
        await f.upload(file,'/app/upload',{onProgress:value=>progress.push(value)});
        const r=f.requests[0];assert.equal(r.method,'POST');assert.equal(r.url,'/app/upload');
        assert.equal(r.form.get('name'),file.name);assert.equal(r.form.get('chunk'),null);assert.equal(r.form.get('chunks'),null);
        assert.equal(await r.form.get('file').text(),contents);assert.equal(progress.at(-1),1);
    }
});
test('slices reconstruct the exact file; first chunk is accepted before parallel chunks and last is sent after all succeed', async () => {
    let release;const waiting=new Promise(resolve=>release=resolve);
    const f=fixture({response:async form=>{if(form.get('chunk')==='1') await waiting;return 200;}});
    const bytes=Uint8Array.from({length:26},(_,i)=>i),file=new File([bytes],'binary.bin');
    const done=f.upload(file,'/upload',{chunkSize:4});await flush();
    assert.deepEqual(f.requests.map(r=>r.form.get('chunk')),['0','1','2','3','4','5']);
    release();await done;
    assert.deepEqual(f.requests.map(r=>r.form.get('chunk')),['0','1','2','3','4','5','6']);
    const result=Buffer.concat(await Promise.all(f.requests.map(async r=>Buffer.from(await r.form.get('file').arrayBuffer()))));
    assert.deepEqual(result,Buffer.from(bytes));assert.ok(f.requests.every(r=>r.form.get('chunks')==='7'));
});
test('transient errors retry at most twice, while permanent errors fail immediately', async () => {
    const f=fixture({response:(form,attempt)=>form.get('chunk')==='0'?(attempt===1?'network':attempt===2?503:200):200});
    await f.upload(new File(['xy'],'a'),'/upload',{chunkSize:1});assert.equal(f.requests.length,4);
    for (const [status,count] of [[400,1],[500,3],['timeout',3]]) {
        const failed=fixture({response:()=>status});
        await assert.rejects(failed.upload(new File(['xy'],'a'),'/upload',{chunkSize:1}));
        assert.equal(failed.requests.length,count);
    }
});

test('HTTP success without the expected completion receipt never counts as uploaded', async () => {
    for (const body of ['', '<html>ok</html>', '{}', '{"status":"chunk_received"}', '{"status":"failed"}']) {
        const f=fixture({response:()=>({status:200,body})});
        await assert.rejects(f.upload(new File(['x'],'a'),'/upload'),/未确认文件保存成功/);
        assert.equal(f.requests.length,1);
    }
});

test('final request waits for merge confirmation and does not retry uncertain completion', async () => {
    let release;const waiting=new Promise(resolve=>release=resolve);
    const f=fixture({response:async form=>{if(form.get('chunk')==='1') await waiting;return 200;}});
    let finished=false;
    const done=f.upload(new File(['xy'],'a'),'/upload',{chunkSize:1}).then(()=>{finished=true;});
    await flush();assert.equal(f.requests.length,2);assert.equal(finished,false);
    release();await done;assert.equal(finished,true);
    for (const result of ['network','timeout',503]) {
        const failed=fixture({response:form=>form.get('chunk')==='1'?result:200});
        await assert.rejects(failed.upload(new File(['xy'],'a'),'/upload',{chunkSize:1}));
        assert.equal(failed.requests.length,2);
    }
});

test('backend save failure is visible on mobile and never renders success', async () => {
    let failed=true;
    const f=fixture({ui:true,response:()=>failed?{status:500,body:JSON.stringify({status:'failed',message:'文件合并失败，请检查磁盘空间。'})}:200});
    const n=f.nodes;
    n['file-input'].files=[new File(['x'],'a')];n['file-input'].events.change();
    await n.ctlBtn.click();
    const row=n.flist.children[0];
    assert.equal(row.children[1].children[0].textContent,'上传失败');
    assert.equal(row.children[2].hidden,false);assert.match(row.children[2].textContent,/文件合并失败/);
    assert.match(n['upload-message'].textContent,/1 个文件上传失败/);assert.equal(f.requests.length,1);
    failed=false;await n.ctlBtn.click();
    assert.equal(row.children[1].children[0].textContent,'已上传');assert.equal(row.children[2].hidden,true);
});

test('queue shows saving until the backend confirms completion', async () => {
    let release;const waiting=new Promise(resolve=>release=resolve);
    const f=fixture({ui:true,response:async()=>{await waiting;return 200;}}),n=f.nodes;
    n['file-input'].files=[new File(['x'],'a')];n['file-input'].events.change();
    const done=n.ctlBtn.click();await flush();
    const label=n.flist.children[0].children[1].children[0];
    assert.equal(label.textContent,'正在保存 / 合并…');assert.equal(n.ctlBtn.disabled,true);
    assert.notEqual(n['upload-message'].textContent,'上传完成');
    release();await done;
    assert.equal(label.textContent,'已上传');assert.equal(n['upload-message'].textContent,'上传完成');
});
test('failed middle chunks never trigger final merge and wait for in-flight requests', async () => {
    const f=fixture({response:form=>form.get('chunk')==='1'?400:200});
    await assert.rejects(f.upload(new File(['abcdefghijklmnopqrstuvwx'],'a'),'/upload',{chunkSize:4}));
    assert.ok(!f.requests.some(r=>r.form.get('chunk')==='5'));
});
test('aborting an in-flight request stops the upload without retries', async () => {
    const f=fixture({response:()=>new Promise(()=>{})}),controller=new AbortController();
    const done=f.upload(new File(['abc'],'a'),'/upload',{signal:controller.signal});controller.abort();
    await assert.rejects(done,{name:'AbortError'});assert.equal(f.requests.length,1);
});
test('queue renders filenames as text, rejects duplicate names and supports removal', () => {
    const f=fixture({ui:true}),n=f.nodes;
    assert.equal(n.ctlBtn.disabled,true);
    n['file-input'].files=[new File(['a'],'<img onerror=alert(1)>.txt'),new File(['b'],'<IMG ONERROR=ALERT(1)>.TXT')];
    n['file-input'].events.change();assert.equal(n.flist.children.length,1);
    assert.equal(n.flist.children[0].children[0].children[1].textContent,'<img onerror=alert(1)>.txt');
    assert.match(n['upload-message'].textContent,/同名/);assert.equal(n.ctlBtn.disabled,false);
    n.flist.children[0].children[1].children[1].click();assert.equal(n.flist.children.length,0);assert.equal(n.ctlBtn.disabled,true);
});
test('batch continues after failure and retry submits only failed files', async () => {
    let failing=true;
    const f=fixture({ui:true,response:form=>failing && form.get('name')==='bad.txt'?400:200}),n=f.nodes;
    n['file-input'].files=[new File(['a'],'bad.txt'),new File(['b'],'good.txt')];n['file-input'].events.change();
    const batch=n.ctlBtn.click();assert.equal(n.picker.disabled,true);assert.equal(n.ctlBtn.disabled,true);await batch;
    assert.deepEqual(f.requests.map(r=>r.form.get('name')),['bad.txt','good.txt']);
    assert.match(n['upload-message'].textContent,/1 个文件上传失败/);assert.equal(n.picker.disabled,false);
    failing=false;await n.ctlBtn.click();assert.deepEqual(f.requests.map(r=>r.form.get('name')),['bad.txt','good.txt','bad.txt']);
    assert.equal(n['upload-message'].textContent,'上传完成');assert.equal(n.ctlBtn.disabled,true);
});
