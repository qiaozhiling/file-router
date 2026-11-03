const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(process.env.TOUCH_SOURCE || path.join(__dirname, '../../main/resources/static/mobile-player-controls.js'), 'utf8');
function fixture() {
    const timers = new Map(); let next = 0, rate = 1.5, state = 6, captured = 0;
    const seeks = [], volumes = []; let duration = 60000n, live = false, rejectSeek = false, seekPromise, volume = 0.5;
    function element() {
        const events = {}, classes = new Set(), properties = new Map(), captures = new Set(), children = [];
        return {events, children, style: {getPropertyValue: name => properties.get(name) || '', setProperty: (name,value) => properties.set(name,value), removeProperty: name => properties.delete(name)},
            classList: {add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle(c,on) { on ? classes.add(c) : classes.delete(c); }},
            addEventListener(n, cb) { events[n] = cb; }, removeEventListener(n) { delete events[n]; },
            appendChild(child) { children.push(child); }, setAttribute() {}, remove() { this.removed = true; },
            setPointerCapture(id) { captured++; captures.add(id); }, hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id)};
    }
    const container = element(), window = element(), document = element();
    container.getBoundingClientRect = () => ({left: 0, top: 0, width: 390, height: 220});
    document.createElement = element;
    const handlers = {};
    const player = {getStatus: () => state, getPlaybackRate: () => rate, setPlaybackRate: value => { rate = value; }, on(n,cb) { handlers[n]=cb; }, off(n) { delete handlers[n]; }};
    player.currentTime = 20000n;
    player.getDuration = () => duration;
    player.getVolume = () => volume;
    player.setVolume = value => { volume = value; volumes.push(value); };
    player.isLive = () => live;
    player.seek = async value => { seeks.push(value); if (rejectSeek) throw Error('failed'); if (seekPromise) await seekPromise; player.currentTime = value; };
    const uiState = {showSettings: false, showInfo: false};
    player.ui = {get: key => uiState[key], set: (key,value) => { uiState[key] = value; }};
    vm.runInNewContext(source, {window, document, Date, Math, setTimeout(cb, ms) { const id=++next; timers.set(id,{cb,ms}); return id; }, clearTimeout(id) { timers.delete(id); }});
    const dispose = window.FileRouterTouchControls(container, player);
    const target = (...classes) => ({closest: selector => selector.split(',').some(value => classes.includes(value.trim())) ? {} : null});
    const screen = target(), control = target('button');
    const fire = (name, extra={}) => container.events[name]?.({pointerType:'touch', isPrimary:true, pointerId:1, clientX:10,clientY:10,target:screen,preventDefault(){},stopPropagation(){},...extra});
    const progress = element();
    progress.getBoundingClientRect = () => ({left:20,top:170,width:350,height:20});
    progress.querySelector = () => progress;
    const progressTarget = {closest: selector => selector.split(',').some(value => ['.avplayer-ui-progress-container','.avplayer-ui-progress','.avplayer-ui-footer'].includes(value.trim())) ? progress : null};
    const tick = ms => { for (const [id,t] of [...timers]) if(t.ms===ms) {timers.delete(id);t.cb();} };
    return {container, window, document, fire, tick, control, dispose, timers, target, uiState, player, seeks, volumes, volume:()=>volume,
        brightness:()=>Number(container.style.getPropertyValue('--player-brightness') || 1),
        gestureHint:container.children.find(child=>child.className.includes('player-gesture-hint')),
        progress, progressTarget, handlers,
        duration:value=>duration=value, live:value=>live=value, rejectSeek:()=>rejectSeek=true, deferSeek:value=>seekPromise=value, captured:()=>captured, rate:()=>rate, state:value=>state=value};
}
test('tap toggles UI; playing controls auto-hide', () => {
    const f=fixture(); f.fire('pointerdown'); f.fire('pointerup');
    f.tick(300);
    assert.equal(f.container.classList.contains('player-controls-hidden'),true);
    f.fire('pointerdown'); f.fire('pointerup');
    f.tick(300);
    assert.equal(f.container.classList.contains('player-controls-hidden'),false);
    f.tick(3500); assert.equal(f.container.classList.contains('player-controls-hidden'),true);
});
test('hold temporarily accelerates and release restores the selected speed without toggling', () => {
    const f=fixture(); f.fire('pointerdown'); f.tick(450); assert.equal(f.rate(),2);
    f.fire('pointerup'); assert.equal(f.rate(),1.5);
    assert.equal(f.container.classList.contains('player-controls-hidden'),true);
});
test('swipe and control taps never start acceleration', () => {
    const f=fixture(); f.fire('pointerdown'); f.fire('pointermove',{clientX:40}); f.tick(450); assert.equal(f.rate(),1.5);
    f.fire('pointerup'); f.fire('pointerdown',{target:f.control}); f.tick(450); assert.equal(f.rate(),1.5);
});
test('cancel, blur, background, pointer capture loss and destruction restore speed', () => {
    for (const stop of [f=>f.fire('pointercancel'),f=>f.window.events.blur(), f=>{f.document.hidden=true;f.document.events.visibilitychange();},f=>f.fire('lostpointercapture'),f=>f.dispose()]) {
        const f=fixture();f.fire('pointerdown');f.tick(450);stop(f);assert.equal(f.rate(),1.5);f.dispose();assert.equal(f.timers.size,0);
    }
});
test('paused playback and multi-touch do not leave a speed override', () => {
    const f=fixture();f.state(8);f.fire('pointerdown');f.tick(450);assert.equal(f.rate(),1.5);f.fire('pointerup');
    f.state(6);f.fire('pointerdown');f.tick(450);f.fire('pointerdown',{pointerId:2,isPrimary:false});assert.equal(f.rate(),1.5);
});
test('synthetic picture clicks are suppressed, control clicks remain available', () => {
    const f=fixture();f.fire('pointerdown');f.tick(450);f.fire('pointerup');let blocked=0;
    f.fire('click',{preventDefault(){blocked++;},stopImmediatePropagation(){blocked++;}});assert.equal(blocked,2);
    f.fire('click',{target:f.control,preventDefault(){blocked++;},stopImmediatePropagation(){blocked++;}});assert.equal(blocked,2);
});

test('a hold after entering fullscreen shows speed feedback until release and works again after exit', () => {
    const f=fixture();
    const hint=f.container.children.find(child=>child.className==='player-speed-hint');
    for (const fullscreen of [true,false]) {
        f.document.fullscreenElement=fullscreen ? f.container : null;
        f.document.events.fullscreenchange();
        f.fire('pointerdown'); f.tick(450);
        assert.equal(f.rate(),2);
        assert.equal(hint.textContent,'2 倍速播放中');
        assert.equal(hint.classList.contains('visible'),true);
        f.fire('pointerup');
        assert.equal(f.rate(),1.5);
        assert.equal(hint.classList.contains('visible'),false);
    }
});

test('settings and playlist panels never capture picture gestures or swallow their click', () => {
    for (const className of ['.avplayer-ui-settings', '.avplayer-ui-mask', '.avplayer-ui-menu', '.player-episode-overlay', '.player-episode-toolbar']) {
        const f=fixture(); f.uiState.showSettings=true;
        const target=f.target(className);
        f.fire('pointerdown',{target});f.tick(450);f.fire('pointerup',{target});
        let blocked=false;
        f.fire('click',{target,preventDefault(){blocked=true;},stopImmediatePropagation(){blocked=true;}});
        assert.equal(f.captured(),0);assert.equal(blocked,false);assert.equal(f.rate(),1.5);
        f.tick(3500);assert.equal(f.container.classList.contains('player-controls-hidden'),false);
        // The upstream close handler can now receive the unblocked click.
        f.uiState.showSettings=false;
    }
});
test('touch settings button toggles open and closed without upstream reopening it', () => {
    const f=fixture(), target=f.target('.avplayer-ui-control-settings','.avplayer-ui-control','.avplayer-ui-footer');
    for (const expected of [true,false,true,false]) {
        f.fire('pointerdown',{target});f.fire('pointerup',{target});let blocked=0;
        f.fire('click',{target,preventDefault(){blocked++;},stopImmediatePropagation(){blocked++;}});
        assert.equal(f.uiState.showSettings,expected);assert.equal(blocked,2);assert.equal(f.captured(),0);
    }
});
test('an already scheduled auto-hide cannot hide controls after settings opens', () => {
    const f=fixture();f.fire('pointerdown',{target:f.control});f.uiState.showSettings=true;
    f.tick(3500);assert.equal(f.container.classList.contains('player-controls-hidden'),false);
});

function tapAt(f, x=300, y=80) {
    f.fire('pointerdown',{clientX:x,clientY:y});
    f.fire('pointerup',{clientX:x,clientY:y});
}
test('double tap on each half seeks two seconds without toggling controls', async () => {
    for (const [x,expected] of [[40,18000n],[340,22000n]]) {
        const f=fixture();tapAt(f,x);tapAt(f,x);await Promise.resolve();
        assert.deepEqual(f.seeks,[expected]);
        assert.equal(f.container.classList.contains('player-controls-hidden'),false);
        assert.equal(f.timers.size,1);f.dispose();assert.equal(f.timers.size,0);
    }
});
test('seek clamps to video boundaries and ignores live, unknown duration and loading', () => {
    const start=fixture();start.player.currentTime=1000n;tapAt(start,40);tapAt(start,40);assert.deepEqual(start.seeks,[0n]);
    const end=fixture();end.player.currentTime=59000n;tapAt(end);tapAt(end);assert.deepEqual(end.seeks,[60000n]);
    for (const setup of [f=>f.live(true),f=>f.duration(0n),f=>f.state(2)]) {
        const f=fixture();setup(f);tapAt(f);tapAt(f);assert.deepEqual(f.seeks,[]);
    }
});
test('taps on opposite sides or far apart do not form a double tap', () => {
    for (const pair of [[40,340],[210,380]]) {
        const f=fixture();tapAt(f,pair[0]);tapAt(f,pair[1]);assert.deepEqual(f.seeks,[]);
    }
});
test('long press, swipe, control taps and backgrounding cancel pending double taps', () => {
    for (const cancel of [f=>{f.fire('pointerdown');f.tick(450);f.fire('pointerup');},f=>{f.fire('pointerdown');f.fire('pointermove',{clientX:50});f.fire('pointerup');},f=>f.fire('pointerdown',{target:f.control}),f=>f.window.events.blur(),f=>f.fire('pointercancel')]) {
        const f=fixture();tapAt(f,40);cancel(f);tapAt(f,40);assert.deepEqual(f.seeks,[]);
    }
});
test('paused video stays paused and overlapping seeks are not submitted', async () => {
    const f=fixture();f.state(8);let finish;f.deferSeek(new Promise(resolve=>finish=resolve));
    tapAt(f);tapAt(f);tapAt(f);tapAt(f);assert.deepEqual(f.seeks,[22000n]);assert.equal(f.player.getStatus(),8);
    finish();await new Promise(resolve=>setImmediate(resolve));tapAt(f,40);tapAt(f,40);assert.deepEqual(f.seeks,[22000n,20000n]);
});
test('seek failure permits retry and touch double-click never triggers desktop actions', async () => {
    const f=fixture();f.rejectSeek();tapAt(f);tapAt(f);await new Promise(resolve=>setImmediate(resolve));
    tapAt(f);tapAt(f);assert.equal(f.seeks.length,2);
    let blocked=0;f.fire('dblclick',{preventDefault(){blocked++;},stopImmediatePropagation(){blocked++;}});assert.equal(blocked,2);
});

function swipe(f, from, to, finish = 'pointerup') {
    f.fire('pointerdown', {clientX:from[0], clientY:from[1]});
    f.fire('pointermove', {clientX:to[0], clientY:to[1]});
    if (finish) f.fire(finish, {clientX:to[0], clientY:to[1]});
}

test('horizontal drag previews from the initial position and seeks only once on release', () => {
    const f = fixture();
    swipe(f, [80,80], [145,80], null);
    assert.deepEqual(f.seeks, []);
    assert.match(f.gestureHint.textContent, /快进 00:10\n00:30 \/ 01:00/);
    f.player.currentTime = 21000n; // Playback continues while previewing.
    f.fire('pointermove', {clientX:210,clientY:82});
    assert.match(f.gestureHint.textContent, /00:40/);
    f.fire('pointerup', {clientX:210,clientY:82});
    assert.deepEqual(f.seeks, [40000n]);
    assert.equal(f.gestureHint.classList.contains('visible'), false);
    assert.equal(f.container.hasPointerCapture(1), false);
    assert.equal(f.volume(), 0.5); assert.equal(f.brightness(), 1);
});

test('seek swipes clamp to boundaries, cap sensitivity for long videos and use final release coordinates', () => {
    const start = fixture(); swipe(start,[200,80],[0,80]); assert.deepEqual(start.seeks,[0n]);
    const end = fixture(); swipe(end,[20,80],[380,80]); assert.deepEqual(end.seeks,[60000n]);
    const long = fixture(); long.duration(7200000n);
    swipe(long,[10,80],[205,80]); assert.deepEqual(long.seeks,[80000n]);
    const fast = fixture(); fast.fire('pointerdown',{clientX:10,clientY:80});
    fast.fire('pointerup',{clientX:75,clientY:80}); assert.deepEqual(fast.seeks,[30000n]);
});

test('vertical swipes on either half leave brightness, volume, progress and controls unchanged', () => {
    for (const x of [80,300]) {
        for (const [from,to] of [[150,40],[40,150]]) {
            const f = fixture(); swipe(f,[x,from],[x,to],null);
            f.tick(450); assert.equal(f.rate(),1.5);
            assert.equal(f.container.style.getPropertyValue('--player-brightness'),'');
            assert.equal(f.volume(),0.5); assert.deepEqual(f.volumes,[]);
            assert.equal(f.gestureHint.classList.contains('visible'),false);
            f.fire('pointerup',{clientX:x,clientY:to}); f.tick(300);
            assert.deepEqual(f.seeks,[]);
            assert.equal(f.container.classList.contains('player-controls-hidden'),false);
            f.dispose(); assert.equal(f.gestureHint.removed,true);
        }
    }
});

test('vertical gestures remain ignored after crossing the screen and horizontal seek stays locked', () => {
    const f = fixture(); swipe(f,[80,150],[82,100],null);
    f.fire('pointermove',{clientX:350,clientY:95});
    assert.equal(f.brightness(),1); assert.deepEqual(f.volumes,[]);
    assert.equal(f.gestureHint.classList.contains('visible'),false);
    f.fire('pointerup',{clientX:350,clientY:95}); assert.deepEqual(f.seeks,[]);
    const seek = fixture(); swipe(seek,[80,80],[145,82],null);
    seek.fire('pointerup',{clientX:145,clientY:210}); assert.deepEqual(seek.seeks,[30000n]);
    assert.equal(seek.brightness(),1); assert.deepEqual(seek.volumes,[]);
});

test('small movement, mouse, controls and settings do not change progress, brightness or volume', () => {
    for (const extra of [{target:fixture().control}, {pointerType:'mouse'}, {target:fixture().target('.avplayer-ui-settings')}]) {
        const f = fixture();
        f.fire('pointerdown',{clientX:80,clientY:150,...extra});
        f.fire('pointermove',{clientX:80,clientY:40,...extra});
        f.fire('pointerup',{clientX:80,clientY:40,...extra});
        assert.deepEqual(f.seeks,[]); assert.deepEqual(f.volumes,[]); assert.equal(f.brightness(),1);
    }
    const f = fixture(); swipe(f,[80,100],[85,104]);
    assert.deepEqual(f.seeks,[]); assert.deepEqual(f.volumes,[]); assert.equal(f.brightness(),1);
    f.tick(300); assert.equal(f.container.classList.contains('player-controls-hidden'),true);
});

test('cancellation, capture loss, multitouch, resizing, fullscreen changes and disposal discard seek previews', () => {
    for (const cancel of [f=>f.fire('pointercancel'), f=>f.fire('lostpointercapture'), f=>f.window.events.blur(),
        f=>{f.document.hidden=true;f.document.events.visibilitychange();}, f=>f.window.events.resize(),
        f=>f.document.events.fullscreenchange(), f=>f.fire('pointerdown',{pointerId:2,isPrimary:false}), f=>f.dispose()]) {
        const f = fixture(); swipe(f,[80,80],[145,80],null); cancel(f);
        f.fire('pointerup',{clientX:145,clientY:80});
        assert.deepEqual(f.seeks,[]); assert.equal(f.gestureHint.classList.contains('visible'),false);
        assert.equal(f.container.hasPointerCapture(1),false); f.dispose(); assert.equal(f.timers.size,0);
    }
});

test('fullscreen vertical swipes remain ignored and seeking uses updated width', () => {
    const f = fixture();
    f.container.getBoundingClientRect = () => ({left:100,top:20,width:800,height:400});
    swipe(f,[400,300],[400,100]); assert.equal(f.brightness(),1);
    swipe(f,[700,300],[700,100]); assert.equal(f.volume(),0.5); assert.deepEqual(f.volumes,[]);
    swipe(f,[200,100],[600,100]); assert.deepEqual(f.seeks,[50000n]);
});

test('paused seeking stays paused and live, unknown duration, loading or overlapping seeks are ignored', async () => {
    const paused = fixture(); paused.state(8); swipe(paused,[80,80],[145,80]);
    assert.equal(paused.player.getStatus(),8); assert.deepEqual(paused.seeks,[30000n]);
    for (const setup of [f=>f.live(true),f=>f.duration(0n),f=>f.state(2)]) {
        const f = fixture(); setup(f); swipe(f,[80,80],[145,80]); assert.deepEqual(f.seeks,[]);
        swipe(f,[300,150],[300,95]); assert.equal(f.volume(),0.5); assert.deepEqual(f.volumes,[]);
    }
    const f = fixture(); let finish; f.deferSeek(new Promise(resolve=>finish=resolve));
    swipe(f,[80,80],[145,80]); swipe(f,[80,80],[145,80]); assert.deepEqual(f.seeks,[30000n]);
    finish(); await new Promise(resolve=>setImmediate(resolve));
    swipe(f,[80,80],[145,80]); assert.deepEqual(f.seeks,[30000n,40000n]);
});

test('a failed swipe can retry', async () => {
    const f = fixture(); f.rejectSeek(); swipe(f,[80,80],[145,80]);
    await new Promise(resolve=>setImmediate(resolve));
    swipe(f,[80,80],[145,80]); assert.equal(f.seeks.length,2);
});

test('an activated hold stays at double speed while moving and never previews or submits a seek', () => {
    for (const fullscreen of [false,true]) {
        for (const [x,y] of [[330,80],[80,190],[330,190]]) {
            const f=fixture();
            f.document.fullscreenElement=fullscreen ? f.container : null;
            f.document.events.fullscreenchange();
            const hint=f.container.children.find(child=>child.className==='player-speed-hint');
            f.fire('pointerdown',{clientX:80,clientY:80}); f.tick(450);
            f.fire('pointermove',{clientX:x,clientY:y,target:f.progressTarget});
            assert.equal(f.rate(),2);
            assert.equal(hint.classList.contains('visible'),true);
            assert.equal(f.gestureHint.classList.contains('visible'),false);
            assert.equal(f.container.classList.contains('player-seek-preview'),false);
            assert.equal(f.container.style.getPropertyValue('--player-seek-percent'),'');
            f.fire('pointerup',{clientX:370,clientY:180,target:f.progressTarget});
            assert.deepEqual(f.seeks,[]);
            assert.equal(f.rate(),1.5);
            assert.equal(hint.classList.contains('visible'),false);
            assert.equal(f.container.hasPointerCapture(1),false);
            // A fresh horizontal gesture still seeks normally.
            swipe(f,[80,80],[145,80]); assert.deepEqual(f.seeks,[30000n]);
            f.dispose();
        }
    }
});

test('release at a different position without a move event cannot turn a hold into seeking', () => {
    const f=fixture(); f.fire('pointerdown',{clientX:80,clientY:80}); f.tick(450);
    f.fire('pointerup',{clientX:330,clientY:80});
    assert.deepEqual(f.seeks,[]); assert.equal(f.rate(),1.5);
});

test('cancelling a moved hold restores speed without seeking', () => {
    for (const cancel of [f=>f.fire('pointercancel'),f=>f.window.events.blur(),f=>f.dispose()]) {
        const f=fixture(); f.fire('pointerdown',{clientX:80,clientY:80}); f.tick(450);
        f.fire('pointermove',{clientX:330,clientY:80}); cancel(f);
        f.fire('pointerup',{clientX:330,clientY:80});
        assert.deepEqual(f.seeks,[]); assert.equal(f.rate(),1.5);
        f.dispose(); assert.equal(f.timers.size,0);
    }
});

test('ended videos still preview and accept horizontal seeking', () => {
    const f=fixture(); f.state(7); f.player.currentTime=60000n;
    swipe(f,[300,80],[170,80],null);
    assert.match(f.gestureHint.textContent,/快退 00:20/);
    f.fire('pointerup',{clientX:170,clientY:80});
    assert.deepEqual(f.seeks,[40000n]);
});

test('starting playback and an outstanding seek do not silently disable horizontal preview', async () => {
    const starting=fixture(); starting.state(5);
    swipe(starting,[80,80],[145,80],null);
    assert.match(starting.gestureHint.textContent,/00:30/);
    starting.state(6); starting.fire('pointerup',{clientX:145,clientY:80});
    assert.deepEqual(starting.seeks,[30000n]);
    const pending=fixture(); let finish;
    pending.deferSeek(new Promise(resolve=>finish=resolve));
    swipe(pending,[80,80],[145,80]);
    swipe(pending,[80,80],[145,80],null);
    assert.match(pending.gestureHint.textContent,/00:30/);
    pending.fire('pointerup',{clientX:145,clientY:80});
    assert.equal(pending.seeks.length,1);
    finish(); await new Promise(resolve=>setImmediate(resolve));
});

test('the footer gradient background does not consume horizontal picture swipes', () => {
    const f=fixture(), target=f.target('.avplayer-ui-footer');
    f.fire('pointerdown',{target,clientX:80,clientY:130});
    f.fire('pointermove',{target,clientX:145,clientY:130});
    assert.match(f.gestureHint.textContent,/00:30/);
    f.fire('pointerup',{target,clientX:145,clientY:130});
    assert.deepEqual(f.seeks,[30000n]);
});

test('touch dragging the progress bar previews absolute time and submits only the release position', () => {
    const f=fixture(); let defaults=0, propagation=0;
    f.fire('pointerdown',{target:f.progressTarget,clientX:195,clientY:180,
        preventDefault(){defaults++;},stopPropagation(){propagation++;}});
    assert.equal(defaults,1); assert.equal(propagation,1);
    assert.match(f.gestureHint.textContent,/00:30/); assert.deepEqual(f.seeks,[]);
    f.fire('pointermove',{clientX:300,clientY:100});
    assert.match(f.gestureHint.textContent,/00:48/);
    assert.equal(f.container.classList.contains('player-seek-preview'),true);
    f.fire('pointerup',{clientX:370,clientY:90});
    assert.deepEqual(f.seeks,[60000n]);
    assert.equal(f.container.classList.contains('player-seek-preview'),false);
    assert.deepEqual(f.volumes,[]); assert.equal(f.brightness(),1);
    let blocked=0;
    f.fire('click',{target:f.progressTarget,preventDefault(){blocked++;},stopImmediatePropagation(){blocked++;}});
    assert.equal(blocked,2); // No second seek via the upstream compatibility click.
});

test('progress taps, boundary drags, cancellation, ended state and mouse controls', () => {
    const tap=fixture(); tap.fire('pointerdown',{target:tap.progressTarget,clientX:195,clientY:180});
    tap.fire('pointerup',{clientX:195,clientY:180}); assert.deepEqual(tap.seeks,[30000n]);
    const start=fixture(); start.fire('pointerdown',{target:start.progressTarget,clientX:195,clientY:180});
    start.fire('pointerup',{clientX:-50,clientY:180}); assert.deepEqual(start.seeks,[0n]);
    const cancel=fixture(); cancel.fire('pointerdown',{target:cancel.progressTarget,clientX:195,clientY:180});
    cancel.fire('pointercancel'); cancel.fire('pointerup',{clientX:370,clientY:180}); assert.deepEqual(cancel.seeks,[]);
    assert.equal(cancel.container.classList.contains('player-seek-preview'),false);
    const ended=fixture(); ended.state(7); ended.fire('pointerdown',{target:ended.progressTarget,clientX:195,clientY:180});
    ended.fire('pointerup',{clientX:195,clientY:180}); assert.deepEqual(ended.seeks,[30000n]);
    const mouse=fixture(); mouse.fire('pointerdown',{pointerType:'mouse',target:mouse.progressTarget,clientX:195,clientY:180});
    mouse.fire('pointerup',{pointerType:'mouse',clientX:195,clientY:180}); assert.deepEqual(mouse.seeks,[]);
    assert.equal(mouse.captured(),0);
});

test('a swipe released while starting or changing waits for readiness and submits the latest target', () => {
    for (const [state, ready] of [[5,'played'],[9,'seeked'],[10,'changed']]) {
        const f=fixture(); f.state(state);
        swipe(f,[80,80],[145,80]); swipe(f,[80,80],[210,80]);
        assert.deepEqual(f.seeks,[]);
        f.state(6); f.handlers[ready]();
        assert.deepEqual(f.seeks,[40000n]);
    }
});

test('a newer release position is submitted after the first seek finishes, with no overlap', async () => {
    const f=fixture(); let finish; f.deferSeek(new Promise(resolve=>finish=resolve));
    swipe(f,[80,80],[145,80]); swipe(f,[80,80],[210,80]);
    assert.deepEqual(f.seeks,[30000n]);
    finish(); await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(f.seeks,[30000n,40000n]);
});

test('destroying controls clears pending seeks and progress compatibility mouse events are blocked', () => {
    const f=fixture(); f.state(5); swipe(f,[80,80],[145,80]);
    f.dispose(); f.state(6);
    assert.deepEqual(f.seeks,[]); assert.equal(f.handlers.seeked,undefined);
    const progress=fixture(); progress.fire('pointerdown',{target:progress.progressTarget,clientX:195,clientY:180});
    let blocked=0;
    progress.fire('mousedown',{target:progress.progressTarget,preventDefault(){blocked++;},stopImmediatePropagation(){blocked++;}});
    assert.equal(blocked,2);
    progress.fire('pointercancel');
    assert.equal(progress.container.style.getPropertyValue('--player-seek-percent'),'');
});
