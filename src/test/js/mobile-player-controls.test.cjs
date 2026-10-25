const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(process.env.TOUCH_SOURCE || path.join(__dirname, '../../main/resources/static/mobile-player-controls.js'), 'utf8');
function fixture() {
    const timers = new Map(); let next = 0, rate = 1.5, state = 6, captured = 0;
    const seeks = []; let duration = 60000n, live = false, rejectSeek = false, seekPromise;
    function element() {
        const events = {}, classes = new Set();
        return {events, classList: {add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle(c,on) { on ? classes.add(c) : classes.delete(c); }},
            addEventListener(n, cb) { events[n] = cb; }, removeEventListener(n) { delete events[n]; },
            appendChild() {}, setAttribute() {}, remove() {}, setPointerCapture() { captured++; }};
    }
    const container = element(), window = element(), document = element();
    container.getBoundingClientRect = () => ({left: 0, width: 390});
    document.createElement = element;
    const handlers = {};
    const player = {getStatus: () => state, getPlaybackRate: () => rate, setPlaybackRate: value => { rate = value; }, on(n,cb) { handlers[n]=cb; }, off(n) { delete handlers[n]; }};
    player.currentTime = 20000n;
    player.getDuration = () => duration;
    player.isLive = () => live;
    player.seek = async value => { seeks.push(value); if (rejectSeek) throw Error('failed'); if (seekPromise) await seekPromise; player.currentTime = value; };
    const uiState = {showSettings: false, showInfo: false};
    player.ui = {get: key => uiState[key], set: (key,value) => { uiState[key] = value; }};
    vm.runInNewContext(source, {window, document, Date, Math, setTimeout(cb, ms) { const id=++next; timers.set(id,{cb,ms}); return id; }, clearTimeout(id) { timers.delete(id); }});
    const dispose = window.FileRouterTouchControls(container, player);
    const target = (...classes) => ({closest: selector => selector.split(',').some(value => classes.includes(value.trim())) ? {} : null});
    const screen = target(), control = target('button');
    const fire = (name, extra={}) => container.events[name]?.({pointerType:'touch', isPrimary:true, pointerId:1, clientX:10,clientY:10,target:screen,...extra});
    const tick = ms => { for (const [id,t] of [...timers]) if(t.ms===ms) {timers.delete(id);t.cb();} };
    return {container, window, document, fire, tick, control, dispose, timers, target, uiState, player, seeks, duration:value=>duration=value, live:value=>live=value, rejectSeek:()=>rejectSeek=true, deferSeek:value=>seekPromise=value, captured:()=>captured, rate:()=>rate, state:value=>state=value};
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

test('settings close icon, tabs and overlay never capture touch or swallow their click', () => {
    for (const className of ['.avplayer-ui-settings', '.avplayer-ui-mask', '.avplayer-ui-menu']) {
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
    const f=fixture(), target=f.target('.avplayer-ui-control-settings','.avplayer-ui-footer');
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
