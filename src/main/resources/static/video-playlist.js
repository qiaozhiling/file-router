(function (global) {
    'use strict';
    global.FileRouterPlaylist = function (container, navigation, player, {episodes, filePath, mediaBase, previewBase, status}) {
        let index = episodes.findIndex(item => item.path === filePath);
        if (index < 0) return () => {};
        let busy = false, disposed = false, returnFocus;
        const listeners = [], controls = [];
        function listen(target, name, callback, options) {
            target.addEventListener(name, callback, options);
            listeners.push(() => target.removeEventListener(name, callback, options));
        }
        function node(tag, className, text) {
            const result = document.createElement(tag);
            result.className = className;
            if (text !== undefined) result.textContent = text;
            return result;
        }
        const encoded = path => path.split('/').map(encodeURIComponent).join('/');
        const heading = node('h1', 'episode-current-name');
        const position = node('p', 'episode-position');
        const actions = node('div', 'episode-actions');
        navigation.append(heading, position, actions);
        const message = node('div', 'player-episode-message');
        message.setAttribute('role', 'status');
        const overlay = node('div', 'player-episode-overlay');
        overlay.hidden = true;
        const panel = node('section', 'player-episode-panel');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', '同目录视频选集');
        const panelHeader = node('div', 'episode-panel-header');
        const panelTitle = node('h2', '', '选集');
        const count = node('span', 'episode-panel-count', episodes.length + ' 个视频');
        const close = node('button', 'episode-close', '关闭');
        close.type = 'button';
        panelHeader.append(panelTitle, count, close);
        const list = node('div', 'episode-list');
        panel.append(panelHeader, list);
        overlay.append(panel);
        container.append(overlay, message);
        function dismiss() {
            if (overlay.hidden) return;
            overlay.hidden = true;
            container.classList.remove('player-episodes-open');
            returnFocus?.focus({preventScroll: true});
        }
        function open(trigger) {
            returnFocus = trigger;
            overlay.hidden = false;
            container.classList.add('player-episodes-open');
            rows[index].scrollIntoView({block: 'nearest'});
            rows[index].focus({preventScroll: true});
        }
        function addControls(parent, definitions, embedded = false) {
            for (const [action, label] of definitions) {
                const button = node('button', 'episode-action ' + (embedded ? 'player-episode-control player-episode-' : 'episode-') + action, label);
                button.type = 'button';
                button.dataset.action = action;
                button.setAttribute('aria-label', label);
                if (embedded) {
                    listen(button, 'click', event => { event.preventDefault(); event.stopPropagation(); });
                    if (action === 'next' || action === 'previous') {
                        const path = action === 'next' ? 'M6 5v14l10-7zM18 5h2v14h-2z' : 'M18 5v14L8 12zM4 5h2v14H4z';
                        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + path + '"/></svg>';
                    }
                }
                if (action === 'list') {
                    button.setAttribute('aria-haspopup', 'dialog');
                    listen(button, 'click', () => open(button));
                } else {
                    listen(button, 'click', () => { void select(index + (action === 'next' ? 1 : -1)); });
                }
                controls.push(button);
                parent.append(button);
            }
        }
        addControls(actions, [['previous', '上一集'], ['next', '下一集'], ['list', '选集']]);
        const previousSlot = node('div', 'avplayer-ui-control-item player-episode-control-slot');
        const nextSlot = node('div', 'avplayer-ui-control-item player-episode-control-slot');
        addControls(previousSlot, [['previous', '上一集']], true);
        addControls(nextSlot, [['next', '下一集']], true);
        // libmedia 1.3.1 owns and can rebuild its footer. Reuse our controls when
        // that happens, without editing the vendored player or duplicating listeners.
        function mountControls() {
            if (disposed) return;
            const left = container.querySelector('.avplayer-ui-footer-left');
            if (left && (previousSlot.parentElement !== left || nextSlot.parentElement !== left)) {
                const play = left.querySelector('.avplayer-ui-control-play')?.closest('.avplayer-ui-control-item');
                if (play) { play.before(previousSlot); play.after(nextSlot); }
                else { left.prepend(nextSlot); left.prepend(previousSlot); }
            }
        }
        const footerObserver = new MutationObserver(mountControls);
        footerObserver.observe(container, {childList: true, subtree: true});
        mountControls();
        const rows = episodes.map((episode, i) => {
            const button = node('button', 'episode-row');
            button.type = 'button';
            button.title = episode.name;
            button.append(node('span', 'episode-number', String(i + 1)), node('span', 'episode-name', episode.name));
            listen(button, 'click', () => { void select(i); });
            list.append(button);
            return button;
        });
        function update() {
            heading.textContent = episodes[index].name;
            heading.title = episodes[index].name;
            position.textContent = '同目录视频 · ' + (index + 1) + ' / ' + episodes.length;
            navigation.setAttribute('aria-busy', String(busy));
            for (const button of controls) {
                const action = button.dataset.action;
                button.disabled = busy || (action === 'previous' && index === 0) || (action === 'next' && index === episodes.length - 1);
                if (action === 'previous' || action === 'next') {
                    const episode = episodes[index + (action === 'next' ? 1 : -1)];
                    const label = action === 'next' ? '下一集' : '上一集';
                    button.title = episode ? (button.classList.contains('player-episode-control') ? label + '：' : '') + episode.name : action === 'next' ? '已是最后一集' : '已是第一集';
                } else {
                    button.title = '选集';
                }
            }
            rows.forEach((row, i) => {
                row.disabled = busy;
                row.classList.toggle('is-current', i === index);
                row.setAttribute('aria-current', i === index ? 'true' : 'false');
            });
        }
        async function select(nextIndex) {
            if (disposed || busy || nextIndex < 0 || nextIndex >= episodes.length) return;
            // Selecting the current row also lets the user retry a failed source load.
            const episode = episodes[nextIndex];
            busy = true; update(); dismiss();
            message.textContent = '正在切换视频…';
            try {
                await player.changeSource({url: mediaBase + encoded(episode.path), filePath: episode.path});
                if (disposed) return;
                index = nextIndex;
                document.title = episode.name + ' · 视频播放';
                // Reloading or sharing the address should reopen the episode now playing.
                global.history.replaceState(null, '', previewBase + encoded(episode.path));
            } catch (error) {
                if (!disposed) status.textContent = error.message;
            } finally {
                busy = false;
                if (!disposed) { message.textContent = status.textContent; update(); }
            }
        }
        listen(close, 'click', dismiss);
        listen(overlay, 'click', event => { if (event.target === overlay) dismiss(); event.stopPropagation(); });
        // Keep keyboard shortcuts behind the modal from seeking or pausing playback.
        listen(document, 'keydown', event => {
            if (overlay.hidden) return;
            event.stopImmediatePropagation();
            if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
            if (event.key === 'Tab') {
                const focusable = [close, ...rows.filter(row => !row.disabled)];
                const current = focusable.indexOf(document.activeElement);
                const next = (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
                event.preventDefault(); focusable[next].focus();
            }
        }, true);
        listen(document, 'fullscreenchange', dismiss);
        const onPlayed = () => { message.textContent = ''; };
        player.on('played', onPlayed);
        document.title = episodes[index].name + ' · 视频播放';
        update();
        return () => {
            disposed = true;
            footerObserver.disconnect();
            listeners.forEach(remove => remove());
            player.off('played', onPlayed);
            previousSlot.remove(); nextSlot.remove(); overlay.remove(); message.remove(); navigation.replaceChildren();
            container.classList.remove('player-episodes-open');
        };
    };
})(window);
