const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../main/resources/static/video-player.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
    let config, player, state = 4, destroyed = 0, selectedSubtitle = 11, selectedAudio = 1;
    const actions = [], requests = [], scripts = [], handlers = new Map(), lifecycle = {};
    let streams = options.streams || [{id: 1, mediaType: 'Audio'}, {id: 11, mediaType: 'Subtitle'}, {id: 12, mediaType: 'Subtitle'}];
    let external = [];
    function emit(name) { for (const callback of [...(handlers.get(name) || [])]) callback(); }
    const window = {
        addEventListener: (name, callback) => { lifecycle[name] = callback; },
        AVPlayer: function (value) {
            config = value; player = this;
            this.on = (name, callback) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(callback); };
            this.off = (name, callback) => handlers.get(name)?.delete(callback);
            this.load = async (url, value = {}) => {
                actions.push(['load', url]);
                if (options.loadError) throw new Error('load failed');
                state = 4; selectedSubtitle = 11; selectedAudio = 1;
                external = value.externalSubtitles || [];
            };
            this.getStreams = () => streams;
            this.loadExternalSubtitle = async subtitle => {
                external.push(subtitle);
                streams = streams.concat({id: 11 + external.length, mediaType: 'Subtitle'});
                actions.push(['external', subtitle]);
            };
            this.getExternalSubtitle = () => external;
            this.getSelectedSubtitleStreamId = () => selectedSubtitle;
            this.getSelectedAudioStreamId = () => selectedAudio;
            this.selectSubtitle = async id => { selectedSubtitle = id; actions.push(['subtitle', id]); };
            this.selectAudio = async id => { selectedAudio = id; actions.push(['audio', id]); };
            this.setSubtitleEnable = enabled => actions.push(['subtitlesEnabled', enabled]);
            this.seek = async timestamp => actions.push(['seek', timestamp]);
            this.getStatus = () => state;
            this.isMSE = () => !!options.mse;
            this.getPlaybackRate = () => 1.5;
            this.getVolume = () => 0.4;
            this.setPlaybackRate = rate => actions.push(['rate', rate]);
            this.setVolume = volume => actions.push(['volume', volume]);
            this.stop = async () => { actions.push(['stop']); state = 0; };
            this.play = async () => { actions.push(['play']); state = 6; emit('played'); emit('time'); };
            this.pause = () => { actions.push(['pause']); state = 8; };
            this.destroy = async () => { destroyed++; };
        }
    };
    vm.runInNewContext(source, {
        window, URLSearchParams,
        fetch: async url => { requests.push(url); return {ok: !options.subtitleError, json: async () => [{id: 4, label: '简体', language: 'chi'}]}; },
        document: {
            createElement: () => ({}),
            head: {appendChild(element) { scripts.push(element.src); queueMicrotask(() => options.scriptError ? element.onerror() : element.onload()); }}
        }
    });
    const status = {};
    return {
        async load(filePath = '/test.mp4') {
            return window.FileRouterVideoPlayer.load({}, {url: '/app/media' + filePath, assets: '/app/libmedia/', status, filePath, subtitlesApi: '/app/api/subtitles'});
        },
        config: () => config, actions, requests, scripts, status, lifecycle, emit,
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
    assert.deepEqual(f.actions.slice(0, 4), [['stop'], ['load', '/app/media/test.mkv'], ['seek', 13000n], ['rate', 1.5]]);
    assert.ok(f.actions.some(a => a[0] === 'volume' && a[1] === 0.4));
    assert.ok(f.actions.some(a => a[0] === 'audio' && a[1] === 2));
    assert.ok(f.actions.some(a => a[0] === 'subtitle' && a[1] === 12));
    assert.deepEqual(f.actions.at(-1), ['subtitlesEnabled', false]);
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
            .replace('[[${filePath}]]', JSON.stringify(filePath)).replace('[[${mediaBase}]]', JSON.stringify('/app/media'));
        vm.runInNewContext(inline, {document: {getElementById: () => ({})}, FileRouterVideoPlayer: {load: async (container, value) => {config = value;}}, console});
        assert.equal(decodeURIComponent(config.url.substring('/app/media'.length)), filePath);
        assert.ok(!template.includes('new DPlayer'));
    }
});
