(function (global) {
    'use strict';
    const CHUNK_SIZE = 1024 * 1024;
    function abortError() { const error = new Error('上传已取消'); error.name = 'AbortError'; return error; }
    function send(url, form, progress, signal) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) { reject(abortError()); return; }
            const xhr = new XMLHttpRequest();
            const abort = () => xhr.abort();
            const finish = callback => value => { signal?.removeEventListener('abort', abort); callback(value); };
            xhr.open('POST', url);
            xhr.timeout = 120000;
            xhr.upload.onprogress = event => { if (event.lengthComputable) progress(event.loaded / event.total); };
            xhr.onload = finish(() => {
                if (xhr.status >= 200 && xhr.status < 300) resolve();
                else { const error = new Error('上传失败（HTTP ' + xhr.status + '）'); error.retryable = xhr.status === 408 || xhr.status === 429 || xhr.status >= 500; reject(error); }
            });
            const networkError = () => { const error = new Error('网络异常，请检查连接后重试'); error.retryable = true; return error; };
            xhr.onerror = finish(() => reject(networkError()));
            xhr.ontimeout = finish(() => reject(networkError()));
            xhr.onabort = finish(() => reject(abortError()));
            signal?.addEventListener('abort', abort, {once: true});
            try { xhr.send(form); } catch (error) { finish(reject)(error); }
        });
    }
    async function upload(file, url, {onProgress = () => {}, signal, chunkSize = CHUNK_SIZE} = {}) {
        const chunks = Math.max(1, Math.ceil(file.size / chunkSize));
        const loaded = new Map();
        let completed = 0, stopped = false;
        // Each request holds one slice. Do not allocate an array for the entire file.
        const report = () => onProgress(file.size ? Math.min(1, (completed + [...loaded.values()].reduce((a, b) => a + b, 0)) / file.size) : 0);
        async function chunk(index) {
            const start = index * chunkSize, end = Math.min(file.size, start + chunkSize);
            for (let attempt = 0; ; attempt++) {
                if (signal?.aborted) throw abortError();
                const form = new FormData();
                form.append('name', file.name);
                if (chunks > 1) { form.append('chunks', String(chunks)); form.append('chunk', String(index)); }
                form.append('file', file.slice(start, end), file.name);
                loaded.set(index, 0);
                try {
                    await send(url, form, fraction => { loaded.set(index, (end - start) * fraction); report(); }, signal);
                    loaded.delete(index); completed += end - start; report(); return;
                } catch (error) {
                    loaded.delete(index); report();
                    if (!error.retryable || attempt >= 2 || signal?.aborted || stopped) throw error;
                    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
                }
            }
        }
        // Start the existing backend session with chunk 0; only submit the final
        // chunk (which signals merging) after all preceding chunks are accepted.
        await chunk(0);
        if (chunks > 1) {
            let next = 1;
            const workers = Array.from({length: Math.min(4, chunks - 2)}, async () => {
                while (!stopped && next < chunks - 1) {
                    const index = next++;
                    try { await chunk(index); } catch (error) { stopped = true; throw error; }
                }
            });
            const results = await Promise.allSettled(workers);
            const failed = results.find(result => result.status === 'rejected');
            if (failed) throw failed.reason;
            await chunk(chunks - 1);
        }
        onProgress(1);
    }
    global.FileRouterUpload = {upload};

    const root = document.getElementById('file-upload');
    if (!root) return;
    const picker = document.getElementById('picker');
    const input = document.getElementById('file-input');
    const startButton = document.getElementById('ctlBtn');
    const list = document.getElementById('flist');
    const message = document.getElementById('upload-message');
    const queue = [];
    const controller = new AbortController();
    let running = false, disposed = false;
    const pending = () => queue.filter(item => item.state === 'queued' || item.state === 'failed');
    function updateButton() {
        startButton.disabled = running || !pending().length;
        picker.disabled = running;
        startButton.textContent = running ? '正在上传中…' : pending().some(item => item.state === 'failed') ? '开始上传 / 重试' : '开始上传';
    }
    function status(item, text, color) { item.status.textContent = text; item.status.style.color = color; }
    function add(file) {
        if (queue.some(item => item.file.name.toLowerCase() === file.name.toLowerCase())) return false;
        const row = document.createElement('div'); row.className = 'file-item';
        const info = document.createElement('div'); info.className = 'file-info';
        const icon = document.createElement('span'); icon.textContent = '📄'; icon.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span'); name.className = 'info'; name.textContent = file.name; name.title = file.name;
        info.append(icon, name);
        const msg = document.createElement('div'); msg.className = 'msg';
        const label = document.createElement('div'); label.className = 'state'; label.textContent = '等待上传…';
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove'; remove.textContent = '删除';
        const item = {file, row, status: label, remove, state: 'queued'};
        remove.addEventListener('click', () => {
            if (running) return;
            queue.splice(queue.indexOf(item), 1); row.remove(); updateButton();
        });
        msg.append(label, remove); row.append(info, msg); list.appendChild(row); queue.push(item); return true;
    }
    picker.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        if (running) return;
        let duplicates = 0;
        for (const file of input.files) if (!add(file)) duplicates++;
        message.textContent = duplicates ? '同名文件已在列表中，请移除后重新选择。' : '';
        input.value = ''; updateButton();
    });
    startButton.addEventListener('click', async () => {
        if (running || !pending().length) return;
        const batch = pending();
        running = true; updateButton(); message.textContent = '';
        queue.forEach(item => { item.remove.disabled = true; });
        try {
            for (const item of batch) {
                if (controller.signal.aborted) break;
                item.state = 'uploading';
                try {
                    await upload(item.file, root.dataset.uploadUrl, {
                        signal: controller.signal,
                        onProgress: fraction => {
                            if (!disposed) status(item, fraction >= 1 ? '正在完成…' : '上传中（' + Math.floor(fraction * 100) + '%）', 'var(--primary-color)');
                        }
                    });
                    item.state = 'done';
                    if (!disposed) status(item, '已上传', 'var(--secondary-color)');
                } catch (error) {
                    item.state = 'failed';
                    if (!disposed) { status(item, '上传出错', 'var(--danger-color)'); item.status.title = error.message; }
                }
            }
        } finally {
            running = false;
            if (!disposed) {
                queue.forEach(item => { item.remove.disabled = false; }); updateButton();
                const failed = batch.filter(item => item.state === 'failed').length;
                message.textContent = failed ? failed + ' 个文件上传失败，可点击重试。' : '上传完成';
            }
        }
    });
    global.addEventListener('pagehide', () => { disposed = true; controller.abort(); }, {once: true});
    updateButton();
})(window);
