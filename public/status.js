function renderStatusBox(boxId, result) {
    const box = document.getElementById(boxId);
    const dot = box.querySelector('.status-dot');
    const msg = box.querySelector('.status-box-message');

    dot.classList.remove('status-dot-pending', 'status-dot-ok', 'status-dot-error', 'status-dot-warning');

    const hasCreditWarning = result.ok && result.lastPaidError;
    dot.classList.add(!result.ok ? 'status-dot-error' : hasCreditWarning ? 'status-dot-warning' : 'status-dot-ok');

    let text = result.ok ? 'Conectado' : `Erro: ${result.message}`;
    if (result.lastPaidError) {
        const when = new Date(result.lastPaidError.time).toLocaleString('pt-BR');
        text += `\n\nÚltima falha em chamada paga (${when}):\n${result.lastPaidError.message}`;
    }
    msg.textContent = text;
}

async function checkApiStatus() {
    const btn = document.getElementById('btn-status-refresh');
    const lastChecked = document.getElementById('status-last-checked');

    btn.disabled = true;
    btn.textContent = 'VERIFICANDO...';
    lastChecked.textContent = 'Verificando...';

    ['status-google', 'status-cnpjbiz', 'status-bigdatacorp'].forEach(id => {
        const box = document.getElementById(id);
        const dot = box.querySelector('.status-dot');
        dot.classList.remove('status-dot-ok', 'status-dot-error');
        dot.classList.add('status-dot-pending');
        box.querySelector('.status-box-message').textContent = 'Verificando...';
    });

    try {
        const res = await fetch('/api/status');
        const data = await res.json();

        renderStatusBox('status-google', data.google);
        renderStatusBox('status-cnpjbiz', data.cnpjBiz);
        renderStatusBox('status-bigdatacorp', data.bigDataCorp);

        lastChecked.textContent = `Última verificação: ${new Date(data.checkedAt).toLocaleString('pt-BR')}`;
    } catch (e) {
        lastChecked.textContent = 'Erro ao verificar status: ' + e.message;
    } finally {
        btn.disabled = false;
        btn.textContent = 'VERIFICAR AGORA';
    }
}

window.checkApiStatus = checkApiStatus;
