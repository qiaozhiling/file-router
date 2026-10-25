const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Events {
    constructor() { this.handlers = new Map(); }
    addEventListener(type, callback) {
        if (!this.handlers.has(type)) this.handlers.set(type, new Set());
        this.handlers.get(type).add(callback);
    }
    removeEventListener(type, callback) { this.handlers.get(type)?.delete(callback); }
    emit(type) { for (const callback of [...(this.handlers.get(type) || [])]) callback(); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture() {
    const listEvents = new Events();
    const textTracks = [];
    textTracks.addEventListener = listEvents.addEventListener.bind(listEvents);
    function textTrack(kind, initialMode) {
        let mode = initialMode;
        return {
            kind,
            get mode() { return mode; },
            set mode(value) {
                if (mode === value) return;
                mode = value;
                queueMicrotask(() => listEvents.emit('change'));
            }
        };
    }
    const embedded = [textTrack('subtitles', 'showing'), textTrack('captions', 'showing')];
    textTracks.push(...embedded);
    const video = new Events();
    video.textTracks = textTracks;
    video.appendChild = element => {
        element.track.kind = element.kind;
        textTracks.push(element.track);
        listEvents.emit('addtrack');
    };
    const select = new Events();
    select.value = '';
    select.options = [];
    select.add = option => select.options.push(option);
    const status = { textContent: '' };
    const elements = [];
    const errors = [];
    const document = {
        getElementById: id => id === 'subtitle-select' ? select : id === 'subtitle-status' ? status : {},
        createElement: () => {
            const element = new Events();
            element.dataset = {};
            element.track = textTrack('subtitles', 'disabled');
            element.readyState = 0;
            element.hasAttribute = name => element[name] !== undefined;
            element.removeAttribute = name => { delete element[name]; };
            element.load = () => { element.readyState = 2; element.emit('load'); };
            elements.push(element);
            return element;
        }
    };
    const template = fs.readFileSync(process.env.FILE_ROUTER_VIDEO_TEMPLATE ||
        path.join(__dirname, '../../main/resources/templates/video.html'), 'utf8');
    const script = template.match(/<script th:inline="javascript">([\s\S]*?)<\/script>/)[1]
        .replace('[[${filePath}]]', JSON.stringify('/fixture.mp4'))
        .replace('[[${mediaBase}]]', JSON.stringify('/media'));
    vm.runInNewContext(script, {
        document, URLSearchParams, console: { error: e => errors.push(e) },
        DPlayer: function () { this.video = video; },
        Option: function (label, value) { this.label = label; this.value = value; },
        fetch: async () => ({ ok: true, json: async () => [
            { id: 4, label: '简体', language: 'chi' }, { id: 5, label: '繁体', language: 'zho' }
        ] })
    });
    await flush();
    return {
        textTracks, embedded, elements, video, status, errors,
        showing: () => textTracks.filter(t => ['subtitles', 'captions'].includes(t.kind) && t.mode === 'showing'),
        choose: async value => { select.value = value; select.emit('change'); await flush(); },
        addEmbedded: () => {
            const late = textTrack('subtitles', 'showing');
            textTracks.push(late);
            listEvents.emit('addtrack');
            return late;
        }
    };
}

test('initial selection disables all embedded tracks and displays only the first external track', async () => {
    const f = await fixture();
    assert.equal(f.showing().length, 1);
    assert.equal(f.showing()[0], f.elements[0].track);
    assert.ok(f.embedded.every(t => t.mode === 'disabled'));
    f.elements[0].load();
    await flush();
    assert.equal(f.status.textContent, '已启用 简体');
    assert.deepEqual(f.errors, []);
});

test('late embedded tracks and browser auto-activation cannot enable a second subtitle', async () => {
    const f = await fixture();
    const late = f.addEmbedded();
    assert.equal(late.mode, 'disabled');
    f.elements[1].track.mode = 'showing';
    await flush();
    assert.equal(f.showing().length, 1);
    assert.equal(f.showing()[0], f.elements[0].track);
});

test('switching and turning subtitles off applies to every subtitle track', async () => {
    const f = await fixture();
    await f.choose('5');
    f.elements[1].load();
    await flush();
    assert.equal(f.showing().length, 1);
    assert.equal(f.showing()[0], f.elements[1].track);
    await f.choose('');
    f.addEmbedded();
    f.video.emit('loadedmetadata');
    await flush();
    assert.equal(f.showing().length, 0);
    assert.equal(f.status.textContent, '字幕已关闭');
});

test('out-of-order load completions after rapid switching do not re-enable an old selection', async () => {
    const f = await fixture();
    await f.choose('5');
    await f.choose('4');
    f.elements[1].load();
    f.elements[0].load();
    await flush();
    assert.equal(f.showing().length, 1);
    assert.equal(f.showing()[0], f.elements[0].track);
    assert.equal(f.status.textContent, '已启用 简体');
});
