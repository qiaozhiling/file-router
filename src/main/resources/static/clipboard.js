(function () {
    'use strict';
    const submit = document.getElementById('submit');
    submit.addEventListener('click', async () => {
        const text = document.getElementById('textup').value;
        if (!text) { alert('empty content'); return; }
        submit.disabled = true;
        try {
            const response = await fetch(submit.dataset.submitUrl, {
                method: 'POST', body: new URLSearchParams({cont: text})
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            alert('success');
        } catch (error) {
            alert('提交失败，请重试');
        } finally { submit.disabled = false; }
    });
    const copy = document.getElementById('copy');
    if (copy) copy.addEventListener('click', async () => {
        const text = document.getElementById('textdown');
        try {
            try {
                if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
                await navigator.clipboard.writeText(text.value);
            } catch (error) {
                // LAN HTTP pages may not have access to the secure Clipboard API.
                text.focus(); text.select();
                if (!document.execCommand('copy')) throw new Error('Copy failed');
            }
            alert('copy success');
        } catch (error) { alert('复制失败，请手动复制'); }
    });
})();
