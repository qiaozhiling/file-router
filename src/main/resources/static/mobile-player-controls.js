(function (global) {
    'use strict';
    global.FileRouterTouchControls = function (container, player) {
        let gesture = null, hideTimer, suppressUntil = 0, disposed = false;
        let pendingTap = null, tapTimer, seekHintTimer, seeking = false;
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
        const isTouch = event => event.pointerType === 'touch' || event.pointerType === 'pen';
        const control = target => target.closest('.avplayer-ui-footer, .avplayer-ui-header, .avplayer-ui-folder-container, .avplayer-ui-context-menu, .avplayer-ui-menu, .avplayer-ui-mask, .avplayer-ui-settings, button, input, select, a');
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
            clearTimeout(gesture.timer);
            if (gesture.rate !== undefined) player.setPlaybackRate(gesture.rate);
            hint.classList.remove('visible');
            gesture = null;
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
        async function skip(side) {
            if (seeking || player.isLive() || ![4, 6, 8].includes(player.getStatus())) return;
            const duration = player.getDuration();
            if (duration <= 0n) return;
            const current = player.currentTime;
            const requested = current + (side === 'left' ? -2000n : 2000n);
            const target = requested < 0n ? 0n : requested > duration ? duration : requested;
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
            if (!event.isPrimary || control(event.target)) { cancelTap(); show(true); return; }
            const current = gesture = {id: event.pointerId, x: event.clientX, y: event.clientY, moved: false};
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
        });
        listen(container, 'pointermove', event => {
            if (!gesture || gesture.id !== event.pointerId) return;
            if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 12) {
                cancelTap();
                gesture.moved = true;
                clearTimeout(gesture.timer);
                if (gesture.rate !== undefined) {
                    player.setPlaybackRate(gesture.rate);
                    delete gesture.rate;
                    hint.classList.remove('visible');
                }
            }
        });
        listen(container, 'pointerup', event => {
            if (!gesture || gesture.id !== event.pointerId) return;
            const isTap = !gesture.moved && gesture.rate === undefined;
            const {x, y} = gesture;
            restore();
            suppressUntil = Date.now() + 700;
            if (isTap) handleTap(x, y);
            else if (!container.classList.contains('player-controls-hidden')) show(true);
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
            if (Date.now() < suppressUntil && !control(event.target)) {
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
        listen(document, 'visibilitychange', () => { if (document.hidden) { cancelTap(); restore(); } });
        const onPlayed = () => show(true);
        const onPaused = () => { restore(); show(true); };
        player.on('played', onPlayed);
        player.on('paused', onPaused);
        return () => {
            if (disposed) return;
            disposed = true;
            cancelTap(); restore(); clearTimeout(hideTimer); clearTimeout(seekHintTimer);
            listeners.forEach(remove => remove());
            player.off('played', onPlayed); player.off('paused', onPaused);
            hint.remove();
            seekHint.remove();
        };
    };
})(window);
