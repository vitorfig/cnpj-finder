async function fetchCitiesMaster() {
    const state = document.getElementById('state-master').value;
    const container = document.getElementById('cities-container-master');
    const actions = document.getElementById('cities-actions-master');

    if (!state) {
        container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.875rem;">Selecione um estado para listar as cidades.</p>';
        actions.style.display = 'none';
        return;
    }

    container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.875rem;">Carregando cidades...</p>';

    try {
        const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios`);
        const cities = await response.json();

        container.innerHTML = cities.map(city => `
            <label class="city-box">
                <input type="checkbox" value="${city.nome}" onchange="updateCitiesCountMaster()">
                <span>${city.nome}</span>
            </label>
        `).join('');

        actions.style.display = 'flex';
        updateCitiesCountMaster();
    } catch (e) {
        container.innerHTML = '<p style="color: #ef4444; padding: 1rem;">Erro ao carregar cidades.</p>';
    }
}

function updateCitiesCountMaster() {
    const selected = document.querySelectorAll('#cities-container-master input:checked').length;
    document.getElementById('cities-count-master').textContent = `${selected} selecionada(s)`;
}

function selectAllCitiesMaster() {
    document.querySelectorAll('#cities-container-master input').forEach(i => i.checked = true);
    updateCitiesCountMaster();
}

function deselectAllCitiesMaster() {
    document.querySelectorAll('#cities-container-master input').forEach(i => i.checked = false);
    updateCitiesCountMaster();
}

async function searchMaster() {
    const state = document.getElementById('state-master').value;
    const segment = document.getElementById('segment-master').value;
    const limit = document.getElementById('limit-master').value;
    const selectedCities = Array.from(document.querySelectorAll('#cities-container-master input:checked')).map(i => i.value);
    const skipRaw = document.getElementById('skip-list-master').value;
    const skipList = skipRaw.split('\n').map(s => s.trim()).filter(s => s.length > 0);

    if (!state || !segment || selectedCities.length === 0) {
        alert('Por favor, preencha Estado, Segmento e selecione pelo menos uma cidade.');
        return;
    }

    const btn = document.getElementById('btn-master-search');
    const loading = document.getElementById('master-loading');
    const resultsSection = document.getElementById('master-results-section');
    const tableBody = document.getElementById('master-table-body');

    // UI Reset
    btn.disabled = true;
    loading.style.display = 'block';
    resultsSection.style.display = 'none';
    tableBody.innerHTML = '';

    try {
        const response = await fetch('/api/master/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                estado: state,
                cidades: selectedCities,
                segment: segment,
                limit: limit ? parseInt(limit) : null,
                skipList: skipList
            })
        });

        const data = await response.json();
        renderMasterResults(data);
        resultsSection.style.display = 'block';
    } catch (e) {
        console.error('Erro no Master Search:', e);
        alert('Erro ao processar a automação mestre. Verifique o console.');
    } finally {
        loading.style.display = 'none';
        btn.disabled = false;
    }
}

function renderMasterResults(results) {
    const tableBody = document.getElementById('master-table-body');
    tableBody.innerHTML = '';

    results.forEach(res => {
        const tr = document.createElement('tr');

        // 1. Google Name Column
        const googleNameHtml = `<div style="font-weight: 700; color: var(--merkos-red); font-size: 1rem;">${res.google.nome}</div>`;

        // 2. Address Column
        const addressHtml = `<div style="font-size: 0.8125rem; color: var(--text-main); font-weight: 500;">${res.google.endereco}</div>`;

        // 3. CNPJ Column
        const cnpjHtml = res.biz.cnpj !== 'Não encontrado' ? `
            <div style="font-weight: 700; font-size: 0.875rem;">${formatCNPJ(res.biz.cnpj)}</div>
            <div style="margin-top: 6px;"><span class="chip ${res.biz.score >= 120 ? 'chip-green' : 'chip-blue'}">${res.biz.score || 0} Match Score</span></div>
        ` : `<span class="chip chip-gray">N/A</span>`;

        // 4. Razão Social Column
        const razaoHtml = res.biz.razao_social !== 'N/A' ? `
            <div style="font-weight: 600; font-size: 0.875rem; color: var(--text-main);">${res.biz.razao_social}</div>
        ` : `<span class="chip chip-gray">Não localizada</span>`;

        // 4b. Data de Fundação Column
        const foundingHtml = `<div style="font-size: 0.875rem;">${formatFoundingDate(res.biz.data_abertura)}</div>`;

        // 5. Deep Data (Live Partners)
        let deepHtml = '';
        if (res.deep.socios && res.deep.socios.length > 0) {
            res.deep.socios.forEach(s => {
                const statusClass = s.fim === 'Ativo' ? 'chip-green' : 'chip-red';
                let tels = '';
                if (s.telefones && s.telefones.length > 0) {
                    s.telefones.forEach(t => {
                        let icon = '📞', colorClass = '';
                        if (t.estrela) { icon = '⭐'; colorClass = 'star-wa'; }
                        else if (t.check) { icon = '✅'; colorClass = 'check-wa'; }
                        tels += `<a href="https://wa.me/${t.link}" target="_blank" class="wa-contact ${colorClass}">${icon} ${t.display}</a>`;
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

        // 5. Social/Web
        const socialHtml = `
            <div style="display: flex; flex-direction: column; gap: 8px text-align: center;">
                ${res.google.website !== 'N/A' ? `<a href="${res.google.website}" target="_blank" class="secondary-btn" style="text-align:center; font-size:0.75rem;">🌐 Website</a>` : ''}
                ${res.google.instagram !== 'N/A' ? `<a href="https://instagram.com/${res.google.instagram.replace('@', '')}" target="_blank" class="secondary-btn" style="text-align:center; font-size:0.75rem; background:#fee2e2; color:#b91c1c;">📸 Instagram</a>` : ''}
                ${res.google.telefone !== 'N/A' ? `<div style="font-size: 0.75rem; color: var(--text-muted); text-align:center;">📞 ${res.google.telefone}</div>` : ''}
            </div>
        `;

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

    window.lastMasterResults = results;
}

function formatCNPJ(cnpj) {
    if (!cnpj || cnpj === 'N/A') return 'N/A';
    const c = cnpj.replace(/\D/g, '');
    if (c.length !== 14) return cnpj;
    return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function exportMasterCSV() {
    if (!window.lastMasterResults) return;

    let csv = 'Empresa (Google);Endereço;CNPJ;Razão Social;Data de Fundação;Sócios;Telefones Live;Website;Instagram\n';
    window.lastMasterResults.forEach(res => {
        const sociosStr = res.deep.socios.map(s => `${s.nome} (${s.fim})`).join(' | ');
        const telsList = [];
        res.deep.socios.forEach(s => s.telefones.forEach(t => {
            let prefix = '';
            if (t.estrela) prefix = '⭐ ';
            else if (t.check) prefix = '✅ ';
            telsList.push(`${prefix}${t.display} (${s.nome.split(' ')[0]})`);
        }));

        const row = [
            res.google.nome,
            res.google.endereco,
            formatCNPJ(res.biz.cnpj),
            res.biz.razao_social,
            formatFoundingDate(res.biz.data_abertura),
            sociosStr,
            telsList.join(' | '),
            res.google.website,
            res.google.instagram
        ].map(val => `"${val.toString().replace(/"/g, '""')}"`);

        csv += row.join(';') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `master_intelligence_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}
