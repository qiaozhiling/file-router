(function () {
    'use strict';
    const nav = document.getElementById('directory-breadcrumbs');
    const toggle = document.getElementById('breadcrumb-toggle');
    nav.classList.add('breadcrumbs-enhanced');
    if (toggle) toggle.addEventListener('click', () => {
        const expanded = nav.classList.toggle('is-expanded');
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', expanded ? '折叠中间目录' : '展开中间目录');
    });
    document.getElementById('copy-directory-path').addEventListener('click', async () => {
        const path = document.getElementById('directory-path').textContent;
        const status = document.getElementById('path-copy-status');
        try {
            try {
                if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
                await navigator.clipboard.writeText(path);
            } catch (error) {
                // Keep copying usable on HTTP pages opened from another device.
                const input = document.createElement('textarea');
                input.value = path;
                input.setAttribute('readonly', '');
                input.style.cssText = 'position:fixed;top:0;left:-9999px;';
                document.body.appendChild(input);
                try {
                    input.select();
                    if (!document.execCommand('copy')) throw new Error('Copy failed');
                } finally { input.remove(); }
            }
            status.textContent = '已复制';
        } catch (error) { status.textContent = '复制失败，请选中路径手动复制'; }
    });
})();
