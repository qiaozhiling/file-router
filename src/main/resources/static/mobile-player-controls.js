(function (global) {
    'use strict';
    global.FileRouterTouchControls = function (container, player) {
        let gesture = null, hideTimer, suppressUntil = 0, disposed = false;
        let pendingTap = null, tapTimer, seekHintTimer, seeking = false, queuedSeek = null;
        const listeners = [];
        const hint = document.createElement('div');
        hint.className = 'player-speed-hint';
        hint.textContent = '2 倍速播放中';
        hint.setAttribute('role', 'status');
        container.appendChild(hint);
        const seekHint = document.createElement('div');
        seekHint.className = 'player-speed-hint player-seek-hint';
        seekHint.setAttribute('role', 'status');
        container.appendChild(seekHint);
        const gestureHint = document.createElement('div');
        gestureHint.className = 'player-speed-hint player-gesture-hint';
        gestureHint.setAttribute('role', 'status');
        container.appendChild(gestureHint);
        const isTouch = event => event.pointerType === 'touch' || event.pointerType === 'pen';
        // The footer's gradient covers part of the picture. Only its actual controls consume gestures.
        const control = target => target.closest('.avplayer-ui-control, .avplayer-ui-progress-container, .avplayer-ui-header, .avplayer-ui-folder-container, .avplayer-ui-context-menu, .avplayer-ui-menu, .avplayer-ui-mask, .avplayer-ui-settings, .player-episode-overlay, button, input, select, a');
        const progress = target => target.closest('.avplayer-ui-progress-container');
        function listen(target, name, callback, options) {
            target.addEventListener(name, callback, options);
            listeners.push(() => target.removeEventListener(name, callback, options));
        }
        function show(visible) {
            clearTimeout(hideTimer);
            container.classList.toggle('player-controls-hidden', !visible);
            if (visible && player.getStatus() === 6 && !player.ui?.get('showSettings') && !player.ui?.get('showInfo')) {
                hideTimer = setTimeout(() => {
                    if (!player.ui?.get('showSettings') && !player.ui?.get('showInfo')) show(false);
                }, 3500);
            }
        }
        function restore() {
            if (!gesture) return;
            const current = gesture;
            gesture = null;
            clearTimeout(current.timer);
            if (current.rate !== undefined) player.setPlaybackRate(current.rate);
            hint.classList.remove('visible');
            gestureHint.classList.remove('visible');
            container.classList.remove('player-seek-preview');
            container.style.removeProperty('--player-seek-percent');
            if (container.hasPointerCapture(current.id)) container.releasePointerCapture(current.id);
        }
        function cancelTap() {
            clearTimeout(tapTimer);
            pendingTap = null;
        }
        function notifySeek(text, side) {
            if (disposed) return;
            clearTimeout(seekHintTimer);
            seekHint.textContent = text;
            seekHint.classList.toggle('seek-left', side === 'left');
            seekHint.classList.add('visible');
            seekHintTimer = setTimeout(() => seekHint.classList.remove('visible'), 1200);
        }
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        // A timeline remains previewable while starting, seeking, changing tracks or ended.
        // libmedia 1.3.1 states: loaded=4, starting=5, played=6, ended=7, paused=8, seeking=9, changing=10.
        const hasTimeline = () => !disposed && !player.isLive() && player.getStatus() >= 4
            && player.getStatus() <= 10 && player.getDuration() > 0n;
        function clampTime(value, duration) {
            return value < 0n ? 0n : value > duration ? duration : value;
        }
        function formatTime(value) {
            const seconds = Number(value / 1000n);
            const minutes = Math.floor(seconds / 60);
            return (minutes >= 60 ? Math.floor(minutes / 60) + ':' : '')
                + String(minutes % 60).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
        }
        async function seekTo(requested) {
            if (!hasTimeline()) return;
            const duration = player.getDuration();
            const current = player.currentTime;
            const target = clampTime(requested, duration);
            if (seeking || [5, 9, 10].includes(player.getStatus())) {
                // Keep the latest release position and submit it once the player is ready.
                queuedSeek = target;
                notifySeek('等待跳转至 ' + formatTime(target), 'right');
                return;
            }
            const side = target < current ? 'left' : 'right';
            const seconds = Math.round(Number(target > current ? target - current : current - target) / 1000);
            if (target === current) return;
            seeking = true;
            notifySeek((side === 'left' ? '快退 ' : '快进 ') + seconds + ' 秒', side);
            try {
                await player.seek(target);
            } catch (error) {
                notifySeek('跳转失败，请重试', side);
            } finally {
                seeking = false;
                drainSeek();
            }
        }
        function drainSeek() {
            if (queuedSeek === null || disposed || seeking || ![4, 6, 7, 8].includes(player.getStatus())) return;
            const target = queuedSeek;
            queuedSeek = null;
            void seekTo(target);
        }
        function previewSeek() {
            const delta = gesture.target - gesture.time;
            gestureHint.textContent = (delta < 0n ? '快退 ' : '快进 ') + formatTime(delta < 0n ? -delta : delta)
                + '\n' + formatTime(gesture.target) + ' / ' + formatTime(gesture.duration);
            gestureHint.classList.add('visible');
            container.classList.add('player-seek-preview');
            container.style.setProperty('--player-seek-percent', Number(gesture.target) / Number(gesture.duration) * 100 + '%');
        }
        function skip(side) {
            return seekTo(player.currentTime + (side === 'left' ? -2000n : 2000n));
        }
        function move(event) {
            if (!gesture || gesture.id !== event.pointerId) return;
            // Once a hold activates, keep it exclusive until release or cancellation.
            if (gesture.rate !== undefined) return;
            if (gesture.mode === 'progress') {
                const ratio = clamp((event.clientX - gesture.bounds.left) / Math.max(1, gesture.bounds.width), 0, 1);
                gesture.target = BigInt(Math.round(Number(gesture.duration) * ratio));
                previewSeek();
                return;
            }
            const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
            if (!gesture.moved) {
                if (Math.hypot(dx, dy) <= 12) return;
                cancelTap();
                gesture.moved = true;
                clearTimeout(gesture.timer);
                gesture.mode = Math.abs(dx) >= Math.abs(dy) && hasTimeline() ? 'seek' : 'ignored';
                clearTimeout(seekHintTimer);
                seekHint.classList.remove('visible');
            }
            if (gesture.mode === 'seek') {
                // One full-width swipe moves up to two minutes (or the entire shorter clip).
                const span = gesture.duration < 120000n ? gesture.duration : 120000n;
                const offset = BigInt(Math.round(dx / Math.max(1, gesture.bounds.width) * Number(span)));
                gesture.target = clampTime(gesture.time + offset, gesture.duration);
                previewSeek();
            }
        }
        function handleTap(x, y) {
            const bounds = container.getBoundingClientRect();
            const side = x < bounds.left + bounds.width / 2 ? 'left' : 'right';
            if (pendingTap && pendingTap.side === side && Date.now() - pendingTap.time <= 300
                && Math.hypot(x - pendingTap.x, y - pendingTap.y) <= 64) {
                cancelTap();
                void skip(side);
                return;
            }
            if (pendingTap) show(container.classList.contains('player-controls-hidden'));
            cancelTap();
            pendingTap = {x, y, side, time: Date.now()};
            tapTimer = setTimeout(() => {
                pendingTap = null;
                show(container.classList.contains('player-controls-hidden'));
            }, 300);
        }
        listen(container, 'pointerdown', event => {
            if (!isTouch(event)) return;
            container.classList.add('player-touch');
            if (gesture) { cancelTap(); restore(); suppressUntil = Date.now() + 700; return; }
            const slider = progress(event.target);
            if (event.isPrimary && slider) {
                // Intercept before the upstream mouse-only slider can handle compatibility events.
                event.preventDefault(); event.stopPropagation();
                cancelTap(); show(true); clearTimeout(hideTimer);
                suppressUntil = Date.now() + 700;
                if (!hasTimeline()) return;
                const track = slider.querySelector('.avplayer-ui-progress-inner') || slider;
                gesture = {id:event.pointerId, x:event.clientX, y:event.clientY, mode:'progress', moved:true,
                    bounds:track.getBoundingClientRect(), time:player.currentTime, duration:player.getDuration()};
                container.setPointerCapture(event.pointerId);
                move(event);
                return;
            }
            if (!event.isPrimary || control(event.target)) { cancelTap(); show(true); return; }
            const current = gesture = {
                id: event.pointerId, x: event.clientX, y: event.clientY, moved: false,
                bounds: container.getBoundingClientRect(), time: player.currentTime, duration: player.getDuration()
            };
            clearTimeout(hideTimer);
            container.setPointerCapture(event.pointerId);
            current.timer = setTimeout(() => {
                if (gesture !== current || current.moved || player.getStatus() !== 6) return;
                cancelTap();
                current.rate = player.getPlaybackRate();
                player.setPlaybackRate(2);
                hint.classList.add('visible');
                show(false);
            }, 450);
        }, true);
        listen(container, 'pointermove', move);
        listen(container, 'pointerup', event => {
            if (!gesture || gesture.id !== event.pointerId) return;
            move(event);
            const isTap = !gesture.moved && gesture.rate === undefined;
            const {x, y, mode, target} = gesture;
            restore();
            suppressUntil = Date.now() + 700;
            if (isTap) handleTap(x, y);
            else {
                if (mode === 'seek' || mode === 'progress') void seekTo(target);
                if (!container.classList.contains('player-controls-hidden')) show(true);
            }
        });
        listen(container, 'pointercancel', () => { cancelTap(); restore(); suppressUntil = Date.now() + 700; });
        listen(container, 'lostpointercapture', () => { if (gesture) { cancelTap(); restore(); } });
        // Block synthetic mouse clicks on the picture after a touch gesture.
        listen(container, 'click', event => {
            // The upstream settings button only opens the panel. On touch,
            // toggle its own state and avoid a second upstream open event.
            if (container.classList.contains('player-touch') && event.target.closest('.avplayer-ui-control-settings') && player.ui) {
                event.preventDefault(); event.stopImmediatePropagation();
                player.ui.set('showSettings', !player.ui.get('showSettings'));
                show(true);
                return;
            }
            if (Date.now() < suppressUntil && (!control(event.target) || progress(event.target))) {
                event.preventDefault(); event.stopImmediatePropagation();
            }
        }, true);
        listen(container, 'mousedown', event => {
            if (Date.now() < suppressUntil && progress(event.target)) {
                event.preventDefault(); event.stopImmediatePropagation();
            }
        }, true);
        listen(container, 'dblclick', event => {
            if (Date.now() < suppressUntil && !control(event.target)) {
                event.preventDefault(); event.stopImmediatePropagation();
            }
        }, true);
        listen(container, 'contextmenu', event => {
            if (container.classList.contains('player-touch') && !control(event.target)) {
                event.preventDefault(); event.stopImmediatePropagation();
            }
        }, true);
        listen(global, 'blur', () => { cancelTap(); restore(); });
        listen(global, 'resize', () => { cancelTap(); restore(); });
        listen(document, 'fullscreenchange', () => { cancelTap(); restore(); });
        listen(document, 'visibilitychange', () => { if (document.hidden) { cancelTap(); restore(); } });
        const onPlayed = () => { show(true); drainSeek(); };
        const onPaused = () => { restore(); show(true); };
        player.on('played', onPlayed);
        player.on('paused', onPaused);
        player.on('seeked', drainSeek);
        player.on('changed', drainSeek);
        show(true);
        return () => {
            if (disposed) return;
            disposed = true;
            queuedSeek = null;
            cancelTap(); restore(); clearTimeout(hideTimer); clearTimeout(seekHintTimer);
            listeners.forEach(remove => remove());
            player.off('played', onPlayed); player.off('paused', onPaused);
            player.off('seeked', drainSeek); player.off('changed', drainSeek);
            hint.remove();
            seekHint.remove();
            gestureHint.remove();
        };
    };
})(window);
