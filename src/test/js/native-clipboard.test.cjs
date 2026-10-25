const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../main/resources/static/clipboard.js'),'utf8');
function fixture({response={ok:true},clipboard,legacy=true}={}) {
    const alerts=[],requests=[];let selected=false;
    const nodes={submit:{dataset:{submitUrl:'/app/uptext'}},textup:{value:'中文 & + % = #\n第二行'},copy:{},textdown:{value:'copy text',focus(){},select(){selected=true;}}};
    for(const node of Object.values(nodes)) node.addEventListener=(name,callback)=>node[name]=callback;
    vm.runInNewContext(source,{document:{getElementById:id=>nodes[id],execCommand:()=>legacy},navigator:{clipboard},URLSearchParams,alert:text=>alerts.push(text),fetch:async (url,options)=>{requests.push({url,options});if(response instanceof Error)throw response;return response;}});
    return {nodes,requests,alerts,selected:()=>selected};
}
test('clipboard submission encodes special characters and restores the submit button',async()=>{
    const f=fixture();const done=f.nodes.submit.click();assert.equal(f.nodes.submit.disabled,true);await done;
    assert.equal(f.requests[0].url,'/app/uptext');assert.equal(f.requests[0].options.method,'POST');
    assert.equal(f.requests[0].options.body.get('cont'),f.nodes.textup.value);
    assert.equal(new URLSearchParams(String(f.requests[0].options.body)).get('cont'),f.nodes.textup.value);
    assert.deepEqual(f.alerts,['success']);assert.equal(f.nodes.submit.disabled,false);
});
test('empty submissions are ignored and HTTP/network failures never report success',async()=>{
    const empty=fixture();empty.nodes.textup.value='';await empty.nodes.submit.click();assert.equal(empty.requests.length,0);
    for(const response of [{ok:false,status:500},new Error('offline')]) {
        const f=fixture({response});await f.nodes.submit.click();assert.deepEqual(f.alerts,['提交失败，请重试']);assert.equal(f.nodes.submit.disabled,false);
    }
});
test('copy uses the Clipboard API with an HTTP-compatible fallback and reports real failures',async()=>{
    let copied;const f=fixture({clipboard:{writeText:async value=>copied=value}});await f.nodes.copy.click();assert.equal(copied,'copy text');assert.equal(f.selected(),false);
    const fallback=fixture({clipboard:{writeText:async()=>{throw Error('denied');}}});await fallback.nodes.copy.click();assert.equal(fallback.selected(),true);assert.deepEqual(fallback.alerts,['copy success']);
    const failed=fixture({legacy:false});await failed.nodes.copy.click();assert.deepEqual(failed.alerts,['复制失败，请手动复制']);
});
