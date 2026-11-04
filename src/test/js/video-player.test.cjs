const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../main/resources/static/video-player.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function element(tag = 'div', classes = '') {
    const attrs = new Map();
    const node = {tagName:tag.toUpperCase(), className:classes, children:[], events:{}, parentElement:null,
        setAttribute: (key,value) => attrs.set(key,value), getAttribute: key => attrs.get(key),
        addEventListener(name,callback) { this.events[name]=callback; }, removeEventListener(name) { delete this.events[name]; },
        appendChild(child) { child.parentElement=this; this.children.push(child); },
        prepend(child) { child.parentElement=this; this.children.unshift(child); },
        remove() { if (this.parentElement) this.parentElement.children=this.parentElement.children.filter(child=>child!==this); this.parentElement=null; },
        closest(selector) { return this.classList.contains(selector.slice(1)) ? this : this.parentElement?.closest(selector) || null; },
        querySelectorAll(selector) {
            const parts=selector.split(' '), found=[];
            const visit=child=>{
                if (child.classList.contains(parts.at(-1).slice(1)) && (parts.length===1 || child.parentElement?.closest(parts[0]))) found.push(child);
                child.children.forEach(visit);
            };
            this.children.forEach(visit); return found;
        },
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    };
    node.classList={contains: name=>node.className.split(' ').includes(name),
        toggle(name,on) { const classes=new Set(node.className.split(' ').filter(Boolean)); on ? classes.add(name) : classes.delete(name); node.className=[...classes].join(' '); },
        remove(name) { this.toggle(name,false); }};
    return node;
}

function fixture(options = {}) {
    let config, player, state = 4, destroyed = 0, selectedSubtitle = 11, selectedAudio = 1;
    const actions = [], requests = [], scripts = [], handlers = new Map(), lifecycle = {};
    let streams = options.streams || [{id: 1, mediaType: 'Audio'}, {id: 11, mediaType: 'Subtitle'}, {id: 12, mediaType: 'Subtitle'}];
    let external = [], subtitleVisible = true, observer;
    const status = {}, container = element(), subtitleControl=element('div','avplayer-ui-control-subtitle-track');
    container.appendChild(subtitleControl);
    function addMenu() {
        const menu=element('div','libmedia-ui-selector');
        menu.appendChild(element('div','libmedia-ui-selector-item active'));
        menu.appendChild(element('div','libmedia-ui-selector-item'));
        menu.appendChild(element('label','libmedia-ui-selector-item'));
        subtitleControl.appendChild(menu); return menu;
    }
    const menu=addMenu();
    function emit(name) { for (const callback of [...(handlers.get(name) || [])]) callback(); }
    const window = {
        addEventListener: (name, callback) => { lifecycle[name] = callback; },
        AVPlayer: function (value) {
            config = value; player = this;
            this.on = (name, callback) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(callback); };
            this.off = (name, callback) => handlers.get(name)?.delete(callback);
            this.load = async (url, value = {}) => {
                actions.push(['load', url]);
                if (options.beforeLoad) await options.beforeLoad(url);
                if (options.loadError === true || (typeof options.loadError === 'function' && options.loadError(url))) throw new Error('load failed');
                if (options.streamsFor) streams = options.streamsFor(url);
                state = 4; selectedSubtitle = 11; selectedAudio = 1;
                external = value.externalSubtitles || [];
                emit('loaded');
            };
            this.getStreams = () => streams;
            this.loadExternalSubtitle = async subtitle => {
                external.push(subtitle);
                streams = streams.concat({id: 11 + external.length, mediaType: 'Subtitle'});
                actions.push(['external', subtitle]);
                emit('streamUpdate');
            };
            this.getExternalSubtitle = () => external;
            this.getSelectedSubtitleStreamId = () => selectedSubtitle;
            this.getSelectedAudioStreamId = () => selectedAudio;
            this.selectSubtitle = async id => { selectedSubtitle = id; actions.push(['subtitle', id]); subtitleVisible=true; emit('changed'); };
            this.selectAudio = async id => { selectedAudio = id; actions.push(['audio', id]); };
            this.setSubtitleEnable = enabled => { subtitleVisible=enabled; actions.push(['subtitlesEnabled', enabled]); };
            this.seek = async timestamp => { actions.push(['seek', timestamp]); if (options.beforeSeek) await options.beforeSeek(); subtitleVisible=true; emit('seeked'); };
            this.getStatus = () => state;
            this.isMSE = () => !!options.mse;
            this.getPlaybackRate = () => 1.5;
            this.getVolume = () => 0.4;
            this.setPlaybackRate = rate => actions.push(['rate', rate]);
            this.setVolume = volume => actions.push(['volume', volume]);
            this.stop = async () => { actions.push(['stop']); state = 0; };
            this.play = async () => { actions.push(['play']); if (options.playError) throw new Error('autoplay blocked'); state = 6; emit('played'); subtitleVisible=true; emit('time'); };
            this.pause = () => { actions.push(['pause']); state = 8; };
            this.destroy = async () => { destroyed++; };
        }
    };
    vm.runInNewContext(source, {
        window, URLSearchParams,
        fetch: async url => { requests.push(url); return {ok: !options.subtitleError, json: async () => [{id: 4, label: '简体', language: 'chi'}]}; },
        document: {
            createElement: tag => element(tag),
            head: {appendChild(element) { scripts.push(element.src); queueMicrotask(() => options.scriptError ? element.onerror() : element.onload()); }}
        },
        MutationObserver: class {
            constructor(callback) { observer=this; this.callback=callback; this.connected=false; }
            observe() { this.connected=true; }
            disconnect() { this.connected=false; }
        }
    });
    return {
        async load(filePath = '/test.mp4') {
            return window.FileRouterVideoPlayer.load(container, {url: '/app/media' + filePath, assets: '/app/libmedia/', status, filePath, subtitlesApi: '/app/api/subtitles'});
        },
        config: () => config, container, actions, requests, scripts, status, lifecycle, emit,
        menu, addMenu, observer:()=>observer, subtitleVisible:()=>subtitleVisible,
        click(item) {
            let blocked=false;
            container.events.click?.({target:item, preventDefault(){}, stopImmediatePropagation(){blocked=true;}});
            return blocked;
        },
        setState: value => { state = value; },
        choose: (audio, subtitle) => { selectedAudio = audio; selectedSubtitle = subtitle; },
        destroyed: () => destroyed
    };
}

test('MP4 and MKV use the same player and prefer native MSE when codecs allow it', async () => {
    for (const file of ['/test.mp4', '/test.mkv']) {
        const f = fixture(); await f.load(file);
        assert.equal(f.config().checkUseMSE(), true);
        assert.equal(f.actions[0][1], '/app/media' + file);
        assert.deepEqual(f.scripts, ['/app/libmedia/cheap-polyfill.js', '/app/libmedia/player-bundle/avplayer.js']);
    }
});

test('fullscreen includes the outer player container that hosts touch feedback overlays', async () => {
    const f = fixture(); await f.load();
    assert.equal(f.config().container, f.container);
    assert.equal(f.config().fullscreenDom, f.container);
});

test('MSE playback hides artwork without requiring the WASM first-frame event', async () => {
    let release;
    const f = fixture({mse: true, beforeLoad: url => url.includes('EP2') ? new Promise(resolve => { release = resolve; }) : undefined});
    const player = await f.load('/EP1.mkv');
    assert.equal(f.container.classList.contains('player-awaiting-frame'), true);
    await player.play();
    assert.equal(f.container.classList.contains('player-awaiting-frame'), false);
    player.pause(); await player.seek(15000n);
    assert.equal(f.container.classList.contains('player-awaiting-frame'), false);
    const switching = player.changeSource({url: '/app/media/EP2.mkv', filePath: '/EP2.mkv'});
    await flush();
    assert.equal(f.container.classList.contains('player-awaiting-frame'), true);
    release(); await switching;
    assert.equal(f.container.classList.contains('player-awaiting-frame'), false);
    await player.destroy();
    f.container.classList.toggle('player-awaiting-frame', true);
    f.emit('firstVideoRendered'); f.emit('played');
    assert.equal(f.container.classList.contains('player-awaiting-frame'), true);
});

test('WASM rendering can hide artwork on its first frame before the played event', async () => {
    const f = fixture(); await f.load('/test.mkv');
    assert.equal(f.container.classList.contains('player-awaiting-frame'), true);
    f.emit('firstVideoRendered');
    assert.equal(f.container.classList.contains('player-awaiting-frame'), false);
});

test('WASM audio/video codecs are local, while text subtitle decoders remain built-in', async () => {
    const f = fixture(); await f.load();
    assert.equal(f.config().getWasm('decoder', 12, 0), '/app/libmedia/decode/mpeg4.wasm');
    assert.equal(f.config().getWasm('decoder', 86018, 1), '/app/libmedia/decode/aac.wasm');
    assert.equal(f.config().getWasm('decoder', 94213, 3), null);
    assert.equal(f.config().getWasm('decoder', -1, 0), null);
});

test('native subtitle streams are not duplicated by the Java fallback', async () => {
    const f = fixture(); await f.load();
    assert.equal(f.requests.length, 0);
    assert.equal(f.actions.filter(a => a[0] === 'external').length, 0);
});

test('subtitle menu offers no subtitles, and choosing the current track enables them again', async () => {
    const f=fixture(); await f.load();
    const off=f.menu.querySelector('.player-subtitle-off-option');
    assert.equal(off.textContent,'不使用字幕');
    assert.equal(off.getAttribute('aria-pressed'),'false');
    assert.equal(f.click(off),true);
    assert.equal(f.subtitleVisible(),false);
    assert.equal(f.container.classList.contains('player-subtitles-off'),true);
    assert.equal(off.getAttribute('aria-pressed'),'true');
    assert.equal(f.click(f.menu.children[1]),false);
    assert.equal(f.subtitleVisible(),true);
    assert.equal(f.container.classList.contains('player-subtitles-off'),false);
    assert.equal(f.actions.filter(action=>action[0]==='subtitle').length,0);
});

test('MSE seek, replay and stream updates preserve the no-subtitles choice', async () => {
    const f=fixture({mse:true}); const player=await f.load(); f.setState(6);
    f.click(f.menu.querySelector('.player-subtitle-off-option'));
    await player.seek(13000n); assert.equal(f.subtitleVisible(),false);
    await player.play(); assert.equal(f.subtitleVisible(),false);
    await player.selectSubtitle(12); assert.equal(f.subtitleVisible(),false);
    f.emit('streamUpdate'); assert.equal(f.subtitleVisible(),false);
    // The add-local-subtitles entry must not implicitly turn rendering back on.
    f.click(f.menu.children.at(-1)); assert.equal(f.subtitleVisible(),false);
    f.click(f.menu.children[2]); await player.selectSubtitle(11);
    assert.equal(f.subtitleVisible(),true);
});

test('rebuilt subtitle menus receive one off option with the current state, and destruction cleans up', async () => {
    const f=fixture(); const player=await f.load();
    f.click(f.menu.querySelector('.player-subtitle-off-option'));
    const rebuilt=f.addMenu(); f.observer().callback(); f.observer().callback();
    assert.equal(rebuilt.querySelectorAll('.player-subtitle-off-option').length,1);
    assert.equal(rebuilt.querySelector('.player-subtitle-off-option').getAttribute('aria-pressed'),'true');
    await player.destroy();
    assert.equal(f.observer().connected,false);
    assert.equal(f.container.events.click,undefined);
    assert.equal(f.container.querySelectorAll('.player-subtitle-off-option').length,0);
    const count=f.actions.length; f.emit('seeked'); assert.equal(f.actions.length,count);
});

test('missing MP4 text streams use the existing Java reader and a WebVTT URL', async () => {
    const f = fixture({streams: []}); await f.load('/a & %.mp4');
    const url = new URL(f.requests[0], 'http://local');
    assert.equal(url.searchParams.get('path'), '/a & %.mp4');
    const subtitle = f.actions.find(a => a[0] === 'external')[1];
    assert.equal(new URL(subtitle.source, 'http://local').pathname, '/app/api/subtitles/track.vtt');
    assert.equal(subtitle.title, '简体');
});

test('fallback subtitle failure remains nonfatal and does not start a converter', async () => {
    const f = fixture({streams: [], subtitleError: true}); await f.load();
    assert.match(f.status.textContent, /字幕加载失败/);
    assert.ok(f.requests.every(url => !url.includes('/api/playback')));
});

test('native MSE seeking uses its existing pipeline without reloading the source', async () => {
    const f = fixture({mse: true}); const player = await f.load();
    f.actions.length = 0; f.setState(6);
    await player.seek(13000n);
    assert.deepEqual(f.actions, [['seek', 13000n]]);
});

test('WASM seeking reloads the original URL and preserves audio, subtitle choice, off state, rate and volume', async () => {
    const f = fixture({streams: [{id: 1, mediaType: 'Audio'}, {id: 2, mediaType: 'Audio'}, {id: 11, mediaType: 'Subtitle'}, {id: 12, mediaType: 'Subtitle'}]});
    const player = await f.load('/test.mkv');
    f.setState(6); f.choose(2, 12); player.setSubtitleEnable(false); f.actions.length = 0;
    await player.seek(13000n); await flush();
    assert.deepEqual(f.actions.filter(action=>action[0]!=='subtitlesEnabled').slice(0, 4), [['stop'], ['load', '/app/media/test.mkv'], ['seek', 13000n], ['rate', 1.5]]);
    assert.ok(f.actions.some(a => a[0] === 'volume' && a[1] === 0.4));
    assert.ok(f.actions.some(a => a[0] === 'audio' && a[1] === 2));
    assert.ok(f.actions.some(a => a[0] === 'subtitle' && a[1] === 12));
    assert.deepEqual(f.actions.at(-1), ['subtitlesEnabled', false]);
    assert.equal(f.subtitleVisible(),false);
});

test('paused WASM seeking pauses again after the playback clock reaches the new position', async () => {
    const f = fixture(); const player = await f.load('/test.mkv');
    f.actions.length = 0; f.setState(8);
    await player.seek(13000n); await flush();
    assert.ok(f.actions.some(a => a[0] === 'pause'));
});

test('asset load failure is visible and navigation releases player memory', async () => {
    await assert.rejects(fixture({scriptError: true}).load(), /播放器模块加载失败/);
    const f = fixture(); await f.load(); f.lifecycle.pagehide();
    assert.equal(f.destroyed(), 1);
});

test('video load failure destroys the player and reports a usable error', async () => {
    const f = fixture({loadError: true});
    await assert.rejects(f.load(), /视频加载失败/);
    assert.equal(f.destroyed(), 1);
});

test('all preview extensions use one template entry and encode special filenames once', async () => {
    const template = fs.readFileSync(path.join(__dirname, '../../main/resources/templates/video.html'), 'utf8');
    for (const extension of ['mp4', 'mkv', 'webm', 'm4v', 'mov', 'avi', 'rmvb']) {
        let config;
        const filePath = '/目录/字 & %#.' + extension;
        const inline = template.match(/<script th:inline="javascript">([\s\S]*?)<\/script>/)[1]
            .replace('[[${filePath}]]', JSON.stringify(filePath)).replace('[[${mediaBase}]]', JSON.stringify('/app/media'))
            .replace('[[${episodes}]]', JSON.stringify([{name: filePath.split('/').at(-1), path: filePath}]));
        vm.runInNewContext(inline, {document: {getElementById: () => ({})}, FileRouterPlaylist: () => () => {},
            FileRouterVideoPlayer: {load: async (container, value) => {config = value; return {destroy: async () => {}};}}, console});
        assert.equal(decodeURIComponent(config.url.substring('/app/media'.length)), filePath);
        assert.ok(!template.includes('new DPlayer'));
    }
});

test('switching episodes reuses the fullscreen player and preserves rate, volume and subtitles-off', async () => {
    const f=fixture(); const player=await f.load('/EP1.mkv');
    player.setSubtitleEnable(false); f.actions.length=0;
    await player.changeSource({url:'/app/media/EP2.mkv',filePath:'/EP2.mkv'});
    assert.deepEqual(f.actions.filter(a=>['stop','load','play','rate','volume'].includes(a[0])),
        [['stop'],['load','/app/media/EP2.mkv'],['rate',1.5],['volume',0.4],['play']]);
    assert.equal(f.subtitleVisible(),false);
    assert.equal(f.config().fullscreenDom,f.container);
    assert.equal(f.destroyed(),0);
    assert.equal(f.scripts.length,2);
    f.actions.length=0;
    await player.seek(15000n);
    assert.ok(f.actions.some(a=>a[0]==='load' && a[1]==='/app/media/EP2.mkv'));
    assert.equal(f.subtitleVisible(),false);
});

test('each episode loads its own fallback subtitles without carrying tracks from the previous source', async () => {
    const f=fixture({streamsFor:()=>[]}); const player=await f.load('/EP1.mp4');
    await player.changeSource({url:'/app/media/EP2.mp4',filePath:'/EP2.mp4'});
    const tracks=player.getExternalSubtitle();
    assert.equal(tracks.length,1);
    assert.equal(new URL(tracks[0].source,'http://local').searchParams.get('path'),'/EP2.mp4');
    assert.equal(new URL(f.requests.at(-1),'http://local').searchParams.get('path'),'/EP2.mp4');
});

test('source changes serialize loads and ignore seek requests until switching finishes', async () => {
    let release;
    const f=fixture({beforeLoad:url=>url.includes('EP2') ? new Promise(resolve=>{release=resolve;}) : undefined});
    const player=await f.load('/EP1.mkv');
    const switching=player.changeSource({url:'/app/media/EP2.mkv',filePath:'/EP2.mkv'});
    await flush();
    await assert.rejects(player.changeSource({url:'/app/media/EP3.mkv',filePath:'/EP3.mkv'}),/稍后切集/);
    await player.seek(123n);
    assert.equal(f.actions.filter(a=>a[0]==='seek').length,0);
    release(); await switching;
    assert.equal(f.actions.filter(a=>a[0]==='load').length,2);
});

test('a pending native seek prevents a concurrent source replacement', async () => {
    let release;
    const f=fixture({mse:true,beforeSeek:()=>new Promise(resolve=>{release=resolve;})});
    const player=await f.load(); f.setState(6);
    const seeking=player.seek(123n);
    await assert.rejects(player.changeSource({url:'/next.mkv',filePath:'/next.mkv'}),/稍后切集/);
    assert.equal(f.actions.filter(a=>a[0]==='stop').length,0);
    release(); await seeking;
});

test('a failed episode can be retried, and an autoplay block leaves the selected source ready to play', async () => {
    let fail=true;
    const f=fixture({loadError:url=>url.includes('EP2') && fail}); const player=await f.load('/EP1.mkv');
    await assert.rejects(player.changeSource({url:'/EP2.mkv',filePath:'/EP2.mkv'}),/重新选集重试/);
    fail=false;
    await player.changeSource({url:'/EP2.mkv',filePath:'/EP2.mkv'});
    assert.equal(f.destroyed(),0);
    const blocked=fixture({playError:true}); const other=await blocked.load();
    await other.changeSource({url:'/EP2.mkv',filePath:'/EP2.mkv'});
    assert.match(blocked.status.textContent,/点击播放/);
    assert.equal(blocked.container.classList.contains('player-awaiting-frame'),true);
});
