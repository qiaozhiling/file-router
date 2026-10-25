const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../main/resources/static/file-browser.js'),'utf8');
function fixture({clipboard,legacy=true,toggle=true}={}) {
    const nodes={};let removed=false,selected=false;
    for(const id of ['directory-breadcrumbs','breadcrumb-toggle','copy-directory-path','directory-path','path-copy-status']) {
        const classes=new Set();nodes[id]={attributes:{},textContent:'',addEventListener:(name,callback)=>nodes[id][name]=callback,
            setAttribute:(name,value)=>nodes[id].attributes[name]=value,classList:{add:name=>classes.add(name),contains:name=>classes.has(name),toggle(name){if(classes.has(name)){classes.delete(name);return false;}classes.add(name);return true;}}};
    }
    nodes['directory-path'].textContent='/番剧/huiye/中文 & + %20 #';
    if(!toggle) delete nodes['breadcrumb-toggle'];
    const document={getElementById:id=>nodes[id],body:{appendChild(){}},execCommand:()=>legacy,
        createElement:()=>({style:{},setAttribute(){},select(){selected=true;},remove(){removed=true;}})};
    vm.runInNewContext(source,{document,navigator:{clipboard}});
    return {nodes,removed:()=>removed,selected:()=>selected};
}
test('mobile breadcrumb expansion stays in sync with its accessible label',()=>{
    const f=fixture(),nav=f.nodes['directory-breadcrumbs'],button=f.nodes['breadcrumb-toggle'];
    assert.equal(nav.classList.contains('breadcrumbs-enhanced'),true);
    button.click();assert.equal(nav.classList.contains('is-expanded'),true);assert.equal(button.attributes['aria-expanded'],'true');
    button.click();assert.equal(nav.classList.contains('is-expanded'),false);assert.equal(button.attributes['aria-expanded'],'false');
});
test('copy preserves path characters and handles root without an expansion button',async()=>{
    let copied;const f=fixture({clipboard:{writeText:async value=>copied=value},toggle:false});
    await f.nodes['copy-directory-path'].click();assert.equal(copied,f.nodes['directory-path'].textContent);assert.equal(f.nodes['path-copy-status'].textContent,'已复制');
});
test('HTTP copy fallback removes temporary input on both success and failure',async()=>{
    for(const legacy of [true,false]) {
        const f=fixture({clipboard:{writeText:async()=>{throw Error('denied');}},legacy});
        await f.nodes['copy-directory-path'].click();assert.equal(f.removed(),true);assert.equal(f.selected(),true);
        assert.equal(f.nodes['path-copy-status'].textContent,legacy?'已复制':'复制失败，请选中路径手动复制');
    }
});
