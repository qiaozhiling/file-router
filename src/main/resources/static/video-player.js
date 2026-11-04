/* Original media is streamed into libmedia's in-memory browser decoder. */
(function (global) {
    'use strict';
    const decoders = {
        12: 'mpeg4', 27: 'h264', 173: 'hevc', 225: 'av1', 139: 'vp8', 167: 'vp9',
        2: 'mpeg2video', 30: 'theora', 7: 'mjpeg',
        14: 'msmpeg4', 15: 'msmpeg4', 16: 'msmpeg4',
        5: 'msmpeg4', 6: 'msmpeg4', 68: 'msmpeg4', 69: 'msmpeg4',
        17: 'wmv', 18: 'wmv', 71: 'wmv',
        86018: 'aac', 86017: 'mp3', 86019: 'ac3', 86056: 'eac3', 86020: 'dca',
        86028: 'flac', 86076: 'opus', 86021: 'vorbis',
        86036: 'ra', 86057: 'ra', 86073: 'ra'
    };
    function script(url) {
        return new Promise((resolve, reject) => {
            const element = document.createElement('script');
            element.src = url;
            element.onload = resolve;
            element.onerror = () => reject(new Error('播放器模块加载失败，请刷新重试。'));
            document.head.appendChild(element);
        });
    }
    function subtitleControls(container, player) {
        let enabled = true, disposed = false;
        const originalEnable = player.setSubtitleEnable;
        function updateMenus() {
            if (disposed) return;
            container.classList.toggle('player-subtitles-off', !enabled);
            for (const menu of container.querySelectorAll('.avplayer-ui-control-subtitle-track .libmedia-ui-selector')) {
                let option = menu.querySelector('.player-subtitle-off-option');
                if (!option) {
                    option = document.createElement('button');
                    option.type = 'button';
                    option.className = 'libmedia-ui-selector-item player-subtitle-off-option';
                    option.textContent = '不使用字幕';
                    menu.prepend(option);
                }
                option.classList.toggle('active', !enabled);
                option.setAttribute('aria-pressed', String(!enabled));
            }
        }
        player.setSubtitleEnable = value => {
            enabled = !!value;
            const result = originalEnable.call(player, enabled);
            updateMenus();
            return result;
        };
        function onClick(event) {
            const item = event.target.closest('.libmedia-ui-selector-item');
            if (!item || !item.closest('.avplayer-ui-control-subtitle-track')) return;
            if (item.classList.contains('player-subtitle-off-option')) {
                event.preventDefault();
                event.stopImmediatePropagation();
                player.setSubtitleEnable(false);
            } else if (item.tagName === 'DIV' && !enabled) {
                // Selecting the current track may not call selectSubtitle, so enable here too.
                player.setSubtitleEnable(true);
            }
        }
        function applyPreference() {
            // libmedia can restart its subtitle renderer when playing, seeking or changing tracks.
            if (!disposed && !enabled) originalEnable.call(player, false);
            // In 1.3.1, play() starts the renderer after firing 'played'. Stop it again afterwards.
            Promise.resolve().then(() => {
                if (!disposed && !enabled) originalEnable.call(player, false);
            });
            updateMenus();
        }
        const events = ['loaded', 'played', 'seeked', 'changed', 'streamUpdate'];
        events.forEach(name => player.on(name, applyPreference));
        container.addEventListener('click', onClick, true);
        const observer = new MutationObserver(updateMenus);
        observer.observe(container, {childList: true, subtree: true});
        updateMenus();
        return {
            get enabled() { return enabled; },
            dispose() {
                if (disposed) return;
                disposed = true;
                observer.disconnect();
                container.removeEventListener('click', onClick, true);
                events.forEach(name => player.off(name, applyPreference));
                for (const option of container.querySelectorAll('.player-subtitle-off-option')) option.remove();
                container.classList.remove('player-subtitles-off');
                player.setSubtitleEnable = originalEnable;
            }
        };
    }
    global.FileRouterVideoPlayer = {
        async load(container, {url, assets, status, subtitlesApi, filePath}) {
            container.classList.toggle('player-awaiting-frame', true);
            status.textContent = '正在加载视频…';
            global.CHEAP_DISABLE_THREAD = true;
            await script(assets + 'cheap-polyfill.js');
            await script(assets + 'player-bundle/avplayer.js');
            const player = new global.AVPlayer({
                container,
                // Include touch feedback overlays outside libmedia's inner UI in fullscreen.
                fullscreenDom: container,
                getWasm(type, codecId, mediaType) {
                    // Text subtitle decoders (including MP4 tx3g) are built into JS.
                    if (type === 'decoder' && mediaType === 3) return null;
                    if (type === 'resampler') return assets + 'resample/resample.wasm';
                    if (type === 'stretchpitcher') return assets + 'stretchpitch/stretchpitch.wasm';
                    let name = decoders[codecId];
                    if (codecId >= 65536 && codecId <= 65572) name = 'pcm';
                    if (codecId >= 69632 && codecId <= 69683) name = 'adpcm';
                    // Let libmedia report unsupported codecs through its error event.
                    if (type !== 'decoder' || !name) return null;
                    return assets + 'decode/' + name + '.wasm';
                },
                // Codec support is validated by libmedia before this preference.
                checkUseMSE: () => true,
                enableWorker: false,
                enableWebCodecs: true,
                enableHardware: true,
                enableWebGPU: false,
                preLoadTime: 1,
                ui: { hasFolder: false, hasHeader: false, hasFooter: true }
            });
            player.on('error', () => { status.textContent = '视频播放失败，请刷新重试。'; });
            player.on('played', () => { status.textContent = ''; });
            const hideArtwork = () => container.classList.remove('player-awaiting-frame');
            // MSE does not emit the WASM render thread's firstVideoRendered event.
            const artworkEvents = ['firstVideoRendered', 'played'];
            artworkEvents.forEach(name => player.on(name, hideArtwork));
            const subtitles = subtitleControls(container, player);
            const attachTouch = () => global.FileRouterTouchControls ? global.FileRouterTouchControls(container, player) : () => {};
            let disposeTouch = attachTouch(), reloading = false, disposed = false;
            const destroy = player.destroy.bind(player);
            player.destroy = async () => {
                disposed = true;
                artworkEvents.forEach(name => player.off(name, hideArtwork));
                subtitles.dispose(); disposeTouch();
                return destroy();
            };
            global.addEventListener('pagehide', () => player.destroy(), { once: true });
            const subtitleStreams = () => player.getStreams().filter(stream => stream.mediaType === 'Subtitle');
            async function loadMedia() {
                container.classList.toggle('player-awaiting-frame', true);
                await player.load(url, {externalSubtitles: []});
                if (disposed) return '';
                let subtitleWarning = '';
                // Retain the Java tx3g reader as a fallback, without duplicate tracks.
                if (!subtitleStreams().length && /\.mp4$/i.test(filePath)) {
                    try {
                        const response = await fetch(subtitlesApi + '?' + new URLSearchParams({path: filePath}));
                        if (!response.ok) throw new Error('字幕读取失败');
                        for (const track of await response.json()) {
                            if (disposed) return '';
                            await player.loadExternalSubtitle({
                                source: subtitlesApi + '/track.vtt?' + new URLSearchParams({path: filePath, track: track.id}),
                                title: track.label, lang: track.language
                            });
                        }
                    } catch (error) {
                        subtitleWarning = '字幕加载失败，视频仍可播放。';
                    }
                }
                if (!disposed) player.setSubtitleEnable(subtitles.enabled);
                return subtitleWarning;
            }
            // Source changes and seeks share one lock: libmedia's async pipeline calls must not overlap.
            player.changeSource = async next => {
                if (disposed) throw new Error('播放器已关闭。');
                if (reloading || [5, 9, 10].includes(player.getStatus())) throw new Error('正在跳转，请稍后切集。');
                reloading = true;
                // Clear queued seeks and any temporary hold speed before capturing preferences.
                disposeTouch();
                const rate = player.getPlaybackRate(), volume = player.getVolume();
                status.textContent = '正在切换视频…';
                try {
                    await player.stop();
                    if (disposed) return;
                    url = next.url; filePath = next.filePath;
                    const warning = await loadMedia();
                    if (disposed) return;
                    player.setPlaybackRate(rate);
                    player.setVolume(volume);
                    try {
                        await player.play();
                        status.textContent = warning;
                    } catch (error) {
                        status.textContent = '视频已切换，播放未开始，请点击播放重试。';
                    }
                    if (!disposed) player.setSubtitleEnable(subtitles.enabled);
                } catch (error) {
                    throw new Error('视频切换失败，可重新选集重试。');
                } finally {
                    reloading = false;
                    if (!disposed) disposeTouch = attachTouch();
                }
            };
            try {
                const subtitleWarning = await loadMedia();
                // Recreate single-threaded decode pipelines on seeking. Flushing an
                // active WASM pipeline can wait indefinitely for buffered frames.
                // Seeking before play uses the demuxer's Range-based initial seek.
                const seek = player.seek.bind(player);
                player.seek = async timestamp => {
                    if (reloading || disposed) return;
                    reloading = true;
                    if (player.getStatus() === 4 || player.isMSE()) {
                        try { return await seek(timestamp); }
                        finally { reloading = false; }
                    }
                    const paused = player.getStatus() === 8;
                    const rate = player.getPlaybackRate();
                    const volume = player.getVolume();
                    const externalSubtitles = player.getExternalSubtitle();
                    const subtitleIndex = subtitleStreams().findIndex(stream => stream.id === player.getSelectedSubtitleStreamId());
                    const audioStreams = player.getStreams().filter(stream => stream.mediaType === 'Audio');
                    const audioIndex = audioStreams.findIndex(stream => stream.id === player.getSelectedAudioStreamId());
                    status.textContent = '正在跳转…';
                    try {
                        await player.stop();
                        await player.load(url, {externalSubtitles});
                        await seek(timestamp);
                        player.setPlaybackRate(rate);
                        player.setVolume(volume);
                        const restoreTracks = async () => {
                            player.off('played', restoreTracks);
                            try {
                                const audio = player.getStreams().filter(stream => stream.mediaType === 'Audio')[audioIndex];
                                if (audio && audio.id !== player.getSelectedAudioStreamId()) await player.selectAudio(audio.id);
                                const subtitle = subtitleStreams()[subtitleIndex];
                                if (subtitle && subtitle.id !== player.getSelectedSubtitleStreamId()) await player.selectSubtitle(subtitle.id);
                                player.setSubtitleEnable(subtitles.enabled);
                                if (paused) {
                                    const pauseAfterTime = () => {
                                        player.off('time', pauseAfterTime);
                                        player.pause();
                                    };
                                    player.on('time', pauseAfterTime);
                                }
                            } catch (error) {
                                status.textContent = '音轨或字幕恢复失败，可在播放器中重新选择。';
                            }
                        };
                        player.on('played', restoreTracks);
                        await player.play();
                    } catch (error) {
                        status.textContent = '跳转失败，请刷新重试。';
                    } finally {
                        reloading = false;
                    }
                };
                status.textContent = subtitleWarning;
            } catch (error) {
                await player.destroy();
                throw new Error('视频加载失败，请刷新重试。');
            }
            return player;
        }
    };
})(window);
