async function searchDeep() {
    const cnpjsVal = document.getElementById('cnpjs-deep').value;
    const container = document.getElementById('deep-results-section');
    const tableBody = document.getElementById('deep-table-body');
    const cardsGrid = document.getElementById('deep-cards-grid');
    const loading = document.getElementById('deep-loading');
    const counter = document.getElementById('deep-counter');
    const btn = document.getElementById('btn-deep-search');

    const cnpjs = cnpjsVal.split('\n').filter(l => l.trim());
    if (cnpjs.length === 0) {
        alert('Por favor, cole pelo menos um CNPJ.');
        return;
    }

    // UI Reset
    btn.disabled = true;
    loading.style.display = 'block';
    container.style.display = 'none';
    counter.textContent = `Processando ${cnpjs.length} CNPJ(s)...`;

    try {
        const res = await fetch('/api/deep/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cnpjs: cnpjsVal })
        });

        const dados = await res.json();
        renderDeepResults(dados);

        counter.textContent = `${dados.length} empresa(s) encontrada(s)`;
        container.style.display = 'block';
    } catch (error) {
        console.error('Erro na Busca Deep:', error);
        alert('Erro ao processar busca. Verifique o console.');
    } finally {
        loading.style.display = 'none';
        btn.disabled = false;
    }
}

function renderDeepResults(dados) {
    const tableBody = document.getElementById('deep-table-body');
    const cardsGrid = document.getElementById('deep-cards-grid');

    tableBody.innerHTML = '';
    cardsGrid.innerHTML = '';

    dados.forEach(empresa => {
        // 1. Render Table Row
        const cnpjFormatado = formatCNPJ(empresa.cnpj);

        const sociosListHtml = empresa.socios.length ? empresa.socios.map(s => {
            const statusClass = s.fim === 'Ativo' ? 'chip-green' : 'chip-red';
            return `
                <div class="partner-box ${s.fim === 'Ativo' ? 'active' : 'old'}">
                    <div style="font-weight: 600; font-size: 0.95rem;">${s.nome}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">
                        📄 ${s.doc} | <span class="chip ${statusClass}" style="font-size:0.6rem; padding: 0.1rem 0.4rem;">${s.fim}</span>
                    </div>
                </div>
            `;
        }).join('') : '<span class="chip chip-gray">Nenhum sócio</span>';

        let telefonesHtml = '';
        empresa.socios.forEach(s => {
            telefonesHtml += `<div style="margin-bottom: 12px;">
                    <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">${s.nome}:</div>`;
            if (s.telefones && s.telefones.length > 0) {
                s.telefones.forEach(t => {
                    let icon = '📞', styleClass = '';
                    if (t.estrela) { icon = '⭐'; styleClass = 'star-wa'; }
                    else if (t.check) { icon = '✅'; styleClass = 'check-wa'; }
                    telefonesHtml += `<a href="https://wa.me/${t.link}" target="_blank" class="wa-contact ${styleClass}">${icon} ${t.display}</a>`;
                });
            } else {
                telefonesHtml += `<span class="chip chip-gray" style="font-size: 0.7rem;">Sem telefone</span>`;
            }
            telefonesHtml += '</div>';
        });

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="white-space: nowrap; font-weight: 600;">${cnpjFormatado}</td>
            <td style="font-weight: 700; color: var(--merkos-red);">${empresa.empresa}</td>
            <td style="max-width: 350px;">${sociosListHtml}</td>
            <td style="max-width: 300px;">${telefonesHtml || '<span class="chip chip-gray">Sem telefones</span>'}</td>
        `;
        tableBody.appendChild(tr);

        // 2. Render Card
        const card = document.createElement('div');
        card.className = 'result-card-deep';
        card.innerHTML = `
            <div style="font-weight: 700; font-size: 1.25rem; color: var(--merkos-red-deep); margin-bottom: 0.5rem;">🏢 ${empresa.empresa}</div>
            <p style="color: var(--text-muted); font-size: 0.875rem; margin-bottom: 1.5rem; font-weight: 500;">CNPJ: ${cnpjFormatado}</p>
            <div class="socios-container">
                ${empresa.socios.map(s => {
            const statusClass = s.fim === 'Ativo' ? 'chip-green' : 'chip-red';
            let sTels = '';
            if (s.telefones && s.telefones.length > 0) {
                s.telefones.forEach(t => {
                    let icon = '📞', styleClass = '';
                    if (t.estrela) { icon = '⭐'; styleClass = 'star-wa'; }
                    else if (t.check) { icon = '✅'; styleClass = 'check-wa'; }
                    sTels += `<a href="https://wa.me/${t.link}" target="_blank" class="wa-contact ${styleClass}">${icon} ${t.display}</a>`;
                });
            }
            return `
                        <div class="partner-box ${s.fim === 'Ativo' ? 'active' : 'old'}">
                            <div style="font-weight: 700; font-size: 1rem;">${s.nome}</div>
                            <div style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 4px; font-weight: 500;">
                                📄 ${s.doc} | 👔 ${s.cargo} | <span class="chip ${statusClass}" style="font-size:0.6rem; padding: 0.1rem 0.4rem;">${s.fim}</span>
                            </div>
                            <div style="margin-top: 0.75rem; display: flex; flex-direction: column; gap: 4px;">
                                ${sTels || '<span style="font-size: 11px; color: var(--text-muted);">Sem telefones live</span>'}
                            </div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
        cardsGrid.appendChild(card);
    });

    window.lastDeepResults = dados;
}

function formatCNPJ(cnpj) {
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function exportDeepCSV() {
    if (!window.lastDeepResults) return;

    let csv = 'CNPJ;Empresa;Socios;Telefones\n';
    window.lastDeepResults.forEach(emp => {
        const cnpj = formatCNPJ(emp.cnpj);
        const socios = emp.socios.map(s => `${s.nome} | ${s.doc} | ${s.cargo} | ${s.fim}`).join('\n');
        const tels = [];
        emp.socios.forEach(s => s.telefones.forEach(t => {
            let prefix = '';
            if (t.estrela) prefix = '⭐ ';
            else if (t.check) prefix = '✅ ';
            tels.push(`${prefix}${t.display} (${s.nome.split(' ')[0]})`);
        }));
        csv += `"${cnpj}";"${emp.empresa}";"${socios.replace(/"/g, '""')}";"${tels.join('\n').replace(/"/g, '""')}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `deep_search_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}
