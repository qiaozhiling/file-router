const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../main/resources/static/video-playlist.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture({files = ['/EP1.mp4', '/EP2.mkv', '/EP10.webm'], current = files[0], change} = {}) {
    let document;
    function element(tag = 'div') {
        const attrs = new Map(), events = new Map();
        const result = {tagName: tag.toUpperCase(), className: '', dataset: {}, children: [], hidden: false, disabled: false,
            setAttribute: (key, value) => attrs.set(key, value), getAttribute: key => attrs.get(key),
            addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
            removeEventListener(name, fn) { events.get(name)?.delete(fn); },
            fire(name, props = {}) { for (const fn of events.get(name) || []) fn({target: result, stopPropagation(){}, stopImmediatePropagation(){}, preventDefault(){}, ...props}); },
            click() { if (!this.disabled) this.fire('click'); },
            append(...children) { children.forEach(child => { child.remove(); child.parentElement = this; this.children.push(child); }); },
            prepend(child) { child.remove(); child.parentElement = this; this.children.unshift(child); },
            before(child) { child.remove(); child.parentElement = this.parentElement; this.parentElement.children.splice(this.parentElement.children.indexOf(this), 0, child); },
            after(child) { child.remove(); child.parentElement = this.parentElement; this.parentElement.children.splice(this.parentElement.children.indexOf(this) + 1, 0, child); },
            replaceChildren() { this.children.forEach(child => { child.parentElement = null; }); this.children = []; },
            remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(item => item !== this); this.parentElement = null; },
            querySelector(selector) { for (const part of selector.split(', ')) { const match = find(this, part.slice(1))[0]; if (match) return match; } return null; },
            closest(selector) { for (let el = this; el; el = el.parentElement) if (el.classList.contains(selector.slice(1))) return el; return null; },
            focus() { document.activeElement = this; }, scrollIntoView() { this.scrolled = true; }
        };
        result.classList = {
            contains: name => result.className.split(' ').includes(name),
            add(...names) { result.className = [...new Set([...result.className.split(' ').filter(Boolean), ...names])].join(' '); },
            remove(...names) { result.className = result.className.split(' ').filter(name => !names.includes(name)).join(' '); },
            toggle(name, enabled) { enabled ? this.add(name) : this.remove(name); }
        };
        return result;
    }
    document = element(); document.createElement = element;
    const container = element(), navigation = element(), status = {textContent: ''};
    function footer() {
        const root = element(), left = element(), right = element(), play = element(), settings = element();
        root.className = 'avplayer-ui-footer';
        left.className = 'avplayer-ui-footer-left'; right.className = 'avplayer-ui-footer-right';
        const playItem = element(), settingsItem = element();
        playItem.className = settingsItem.className = 'avplayer-ui-control-item';
        play.className = 'avplayer-ui-control-play'; settings.className = 'avplayer-ui-control-settings';
        playItem.append(play); settingsItem.append(settings); left.append(playItem); right.append(settingsItem);
        root.append(left, right); container.append(root);
        return {root, left, right, playItem, settingsItem};
    }
    let bar = footer(), observer;
    class MutationObserver {
        constructor(callback) { this.callback = callback; observer = this; }
        observe() { this.connected = true; }
        disconnect() { this.connected = false; }
    }
    const history = [], changes = [], handlers = new Map(), timers = new Map();
    const player = {
        getStatus: () => 6,
        on(name, fn) { handlers.set(name, fn); }, off(name) { handlers.delete(name); },
        async changeSource(next) { changes.push(next); if (change) await change(next); }
    };
    let timerId = 0;
    const window = {history: {replaceState: (a, b, url) => history.push(url)}};
    vm.runInNewContext(source, {window, document, MutationObserver, setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id)});
    const dispose = window.FileRouterPlaylist(container, navigation, player, {
        episodes: files.map(file => ({name: file.split('/').at(-1), path: file})), filePath: current,
        mediaBase: '/router/media', previewBase: '/router/v1', status
    });
    function find(parent, className) {
        return parent.children.flatMap(child => [...(child.classList.contains(className) ? [child] : []), ...find(child, className)]);
    }
    return {container, navigation, status, document, history, changes, handlers, timers, dispose, bar, observer,
        rebuildFooter() { bar.root.remove(); bar = footer(); observer.callback(); return bar; },
        buttons: action => [...find(container, 'episode-action'), ...find(navigation, 'episode-action')].filter(item => item.dataset.action === action),
        rows: find(container, 'episode-row'), overlay: find(container, 'player-episode-overlay')[0],
        close: find(container, 'episode-close')[0], heading: find(navigation, 'episode-current-name')[0]};
}

test('inline and fullscreen controls share the current episode and disable both boundaries', async () => {
    const f = fixture();
    assert.equal(f.buttons('previous').length, 2);
    assert.ok(f.buttons('previous').every(button => button.disabled));
    assert.equal(f.rows[0].getAttribute('aria-current'), 'true');
    f.buttons('next')[0].click(); await flush();
    assert.equal(f.heading.textContent, 'EP2.mkv');
    assert.ok(f.buttons('previous').every(button => !button.disabled));
    f.buttons('next')[1].click(); await flush();
    assert.equal(f.heading.textContent, 'EP10.webm');
    assert.ok(f.buttons('next').every(button => button.disabled));
    assert.equal(f.rows[2].getAttribute('aria-current'), 'true');
});

test('selecting special filenames encodes each path segment once and updates the reload/share address', async () => {
    const file = '/目录/EP2 & %#.mp4';
    const f = fixture({files: ['/目录/EP1.mkv', file]});
    f.buttons('list')[1].click();
    assert.equal(f.overlay.hidden, false);
    f.rows[1].click(); await flush();
    assert.equal(f.overlay.hidden, true);
    assert.equal(f.changes[0].filePath, file);
    assert.equal(f.changes[0].url, '/router/media/' + ['目录', 'EP2 & %#.mp4'].map(encodeURIComponent).join('/'));
    assert.equal(decodeURIComponent(f.history[0].slice('/router/v1'.length)), file);
    assert.equal(f.document.title, 'EP2 & %#.mp4 · 视频播放');
});

test('single-video directories disable previous/next and keep selection available', () => {
    const f = fixture({files: ['/only.mp4']});
    assert.ok(f.buttons('previous').every(button => button.disabled));
    assert.ok(f.buttons('next').every(button => button.disabled));
    assert.ok(f.buttons('list').every(button => !button.disabled));
});

test('rapid repeated clicks cannot start overlapping source loads', async () => {
    let release;
    const f = fixture({change: () => new Promise(resolve => { release = resolve; })});
    f.buttons('next')[0].click(); f.buttons('next')[1].click(); f.rows[2].click();
    assert.equal(f.changes.length, 1);
    assert.equal(f.navigation.getAttribute('aria-busy'), 'true');
    release(); await flush();
    assert.equal(f.navigation.getAttribute('aria-busy'), 'false');
    assert.equal(f.heading.textContent, 'EP2.mkv');
});

test('switch failure shows feedback without publishing a wrong URL and permits retry', async () => {
    let fail = true;
    const f = fixture({change: () => { if (fail) throw new Error('切换失败'); }});
    f.buttons('next')[0].click(); await flush();
    assert.equal(f.status.textContent, '切换失败');
    assert.equal(f.history.length, 0);
    assert.equal(f.heading.textContent, 'EP1.mp4');
    fail = false;
    f.buttons('next')[0].click(); await flush();
    assert.equal(f.heading.textContent, 'EP2.mkv');
});

test('selection focuses the current row, traps keyboard navigation and restores focus on Escape', () => {
    const f = fixture({current: '/EP2.mkv'});
    const trigger = f.buttons('list')[0]; trigger.click();
    assert.equal(f.document.activeElement, f.rows[1]);
    assert.equal(f.rows[1].scrolled, true);
    f.document.fire('keydown', {key: 'Tab'});
    assert.equal(f.document.activeElement, f.rows[2]);
    f.document.fire('keydown', {key: 'Tab'});
    assert.equal(f.document.activeElement, f.close);
    f.document.fire('keydown', {key: 'Escape'});
    assert.equal(f.overlay.hidden, true);
    assert.equal(f.document.activeElement, trigger);
});

test('dispose removes overlays, event handlers and timers, even during a pending switch', async () => {
    let release;
    const f = fixture({change: () => new Promise(resolve => { release = resolve; })});
    f.buttons('next')[0].click(); f.dispose(); release(); await flush();
    assert.equal(f.container.children.length, 1);
    assert.equal(f.container.children[0], f.bar.root);
    assert.equal(f.buttons('next').length, 0);
    assert.equal(f.buttons('list').length, 0);
    assert.equal(f.observer.connected, false);
    assert.equal(f.navigation.children.length, 0);
    assert.equal(f.history.length, 0);
    assert.equal(f.handlers.size, 0);
    assert.equal(f.timers.size, 0);
});

test('next and playlist buttons mount in the native footer and survive reconstruction without duplicates', async () => {
    const f = fixture();
    const next = f.buttons('next')[0], list = f.buttons('list')[0];
    assert.equal(next.getAttribute('aria-label'), '下一集');
    assert.equal(f.bar.left.children[0].children[0], f.buttons('previous')[0]);
    assert.equal(f.bar.left.children[1], f.bar.playItem);
    assert.equal(f.bar.left.children[2].children[0], next);
    assert.equal(f.bar.right.children[0].children[0], list);
    assert.equal(f.bar.right.children[1], f.bar.settingsItem);
    assert.equal(f.container.querySelector('.player-episode-toolbar'), null);
    f.observer.callback(); f.observer.callback();
    assert.equal(f.buttons('next').length, 2);
    const bar = f.rebuildFooter(); f.observer.callback();
    assert.equal(bar.left.children[2].children[0], next);
    assert.equal(bar.right.children[0].children[0], list);
    assert.equal(f.buttons('next').length, 2);
    next.click(); await flush();
    assert.equal(f.changes.length, 1);
    assert.equal(f.heading.textContent, 'EP2.mkv');
    assert.equal(f.timers.size, 0);
    list.click(); assert.equal(f.overlay.hidden, false);
});
