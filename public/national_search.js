function updateStatesCountNational() {
    const selected = document.querySelectorAll('#states-container-national input:checked').length;
    document.getElementById('states-count-national').textContent = `${selected} selecionado(s)`;
}

function selectAllStatesNational() {
    document.querySelectorAll('#states-container-national input').forEach(i => i.checked = true);
    updateStatesCountNational();
}

function deselectAllStatesNational() {
    document.querySelectorAll('#states-container-national input').forEach(i => i.checked = false);
    updateStatesCountNational();
}

async function searchNational() {
    const segment = document.getElementById('segment-national').value.trim();
    const limit = document.getElementById('limit-national').value;
    const selectedStates = Array.from(document.querySelectorAll('#states-container-national input:checked')).map(i => i.value);
    const skipRaw = document.getElementById('skip-list-national').value;
    const skipList = skipRaw.split('\n').map(s => s.trim()).filter(s => s.length > 0);

    if (!segment || selectedStates.length === 0) {
        alert('Preencha o Segmento e selecione ao menos um estado.');
        return;
    }

    const btn = document.getElementById('btn-national-search');
    const loading = document.getElementById('national-loading');
    const resultsSection = document.getElementById('national-results-section');
    const tableBody = document.getElementById('national-table-body');
    const loadingText = document.getElementById('national-loading-text');

    btn.disabled = true;
    loading.style.display = 'block';
    resultsSection.style.display = 'none';
    tableBody.innerHTML = '';
    loadingText.textContent = `Buscando "${segment}" em ${selectedStates.length} estado(s)...`;

    try {
        const response = await fetch('/api/national/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                estados: selectedStates,
                segment,
                limit: limit ? parseInt(limit) : null,
                skipList
            })
        });

        const data = await response.json();
        if (data.error) {
            alert('Erro: ' + data.error);
            return;
        }

        renderNationalResults(data);
        resultsSection.style.display = 'block';
    } catch (e) {
        console.error('Erro na Busca Nacional:', e);
        alert('Erro ao processar a busca. Verifique o console.');
    } finally {
        loading.style.display = 'none';
        btn.disabled = false;
    }
}

function renderNationalResults(results) {
    const tableBody = document.getElementById('national-table-body');
    tableBody.innerHTML = '';

    if (results.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-muted);">Nenhum resultado encontrado.</td></tr>';
        return;
    }

    results.forEach(res => {
        const tr = document.createElement('tr');

        const googleNameHtml = `<div style="font-weight: 700; color: var(--merkos-red); font-size: 1rem;">${res.google.nome}</div>`;
        const addressHtml = `<div style="font-size: 0.8125rem; color: var(--text-main); font-weight: 500;">${res.google.endereco}</div>`;

        const socialHtml = `
            <div style="display: flex; flex-direction: column; gap: 8px; text-align: center;">
                ${res.google.website !== 'N/A' ? `<a href="${res.google.website}" target="_blank" class="secondary-btn" style="text-align:center; font-size:0.75rem;">🌐 Website</a>` : ''}
                ${res.google.instagram !== 'N/A' ? `<a href="https://instagram.com/${res.google.instagram.replace('@', '')}" target="_blank" class="secondary-btn" style="text-align:center; font-size:0.75rem; background:#fee2e2; color:#b91c1c;">📸 Instagram</a>` : ''}
                ${res.google.telefone !== 'N/A' ? `<div style="font-size: 0.75rem; color: var(--text-muted); text-align:center;">📞 ${res.google.telefone}</div>` : ''}
            </div>
        `;

        const cnpjHtml = res.biz.cnpj !== 'Não encontrado' ? `
            <div style="font-weight: 700; font-size: 0.875rem;">${formatNationalCNPJ(res.biz.cnpj)}</div>
            <div style="margin-top: 6px;"><span class="chip ${(res.biz.score || 0) >= 120 ? 'chip-green' : 'chip-blue'}">${res.biz.score || 0} Match Score</span></div>
        ` : `<span class="chip chip-gray">N/A</span>`;

        const razaoHtml = res.biz.razao_social && res.biz.razao_social !== 'N/A' ? `
            <div style="font-weight: 600; font-size: 0.875rem;">${res.biz.razao_social}</div>
        ` : `<span class="chip chip-gray">Não localizada</span>`;

        const foundingHtml = `<div style="font-size: 0.875rem;">${formatFoundingDate(res.biz.data_abertura)}</div>`;

        let deepHtml = '';
        if (res.deep.socios && res.deep.socios.length > 0) {
            res.deep.socios.forEach(s => {
                const statusClass = s.fim === 'Ativo' ? 'chip-green' : 'chip-red';
                let tels = '';
                if (s.telefones && s.telefones.length > 0) {
                    s.telefones.forEach(t => {
                        let icon = '📞';
                        if (t.estrela) icon = '⭐';
                        else if (t.check) icon = '✅';
                        tels += `<a href="https://wa.me/${t.link}" target="_blank" class="wa-contact">${icon} ${t.display}</a>`;
                    });
                }
                deepHtml += `
                    <div style="margin-bottom: 12px; border-bottom: 1px solid var(--border); padding-bottom: 6px;">
                        <div style="font-size: 0.875rem; font-weight: 600; display:flex; align-items:center; gap:8px;">
                            ${s.nome} <span class="chip ${statusClass}" style="font-size:0.6rem; padding: 0.1rem 0.4rem;">${s.fim}</span>
                        </div>
                        <div style="margin-top: 4px;">${tels || '<span style="font-size: 0.75rem; color: var(--text-muted);">Sem telefones live</span>'}</div>
                    </div>
                `;
            });
        } else {
            deepHtml = '<span class="chip chip-gray">Sem dados de sócios</span>';
        }

        tr.innerHTML = `
            <td>${googleNameHtml}</td>
            <td style="min-width: 200px;">${addressHtml}</td>
            <td>${socialHtml}</td>
            <td>${cnpjHtml}</td>
            <td>${razaoHtml}</td>
            <td>${foundingHtml}</td>
            <td style="max-width: 320px;">${deepHtml}</td>
        `;
        tableBody.appendChild(tr);
    });

    window.lastNationalResults = results;
}

function formatNationalCNPJ(cnpj) {
    if (!cnpj || cnpj === 'N/A') return 'N/A';
    const c = cnpj.replace(/\D/g, '');
    if (c.length !== 14) return cnpj;
    return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function exportNationalCSV() {
    if (!window.lastNationalResults || window.lastNationalResults.length === 0) return;

    let csv = 'Empresa (Google);Endereço;CNPJ;Razão Social;Data de Fundação;Sócios;Telefones Live;Website;Instagram\n';
    window.lastNationalResults.forEach(res => {
        const sociosStr = (res.deep.socios || []).map(s => `${s.nome} (${s.fim})`).join(' | ');
        const telsList = [];
        (res.deep.socios || []).forEach(s => (s.telefones || []).forEach(t => {
            let prefix = t.estrela ? '⭐ ' : t.check ? '✅ ' : '';
            telsList.push(`${prefix}${t.display} (${s.nome.split(' ')[0]})`);
        }));

        const row = [
            res.google.nome,
            res.google.endereco,
            formatNationalCNPJ(res.biz.cnpj),
            res.biz.razao_social || 'N/A',
            formatFoundingDate(res.biz.data_abertura),
            sociosStr,
            telsList.join(' | '),
            res.google.website || 'N/A',
            res.google.instagram || 'N/A'
        ].map(val => `"${(val || '').toString().replace(/"/g, '""')}"`);

        csv += row.join(';') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `busca_nacional_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}
