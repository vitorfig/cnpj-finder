function parseEnrichLine(line) {
    let parts;
    if (line.includes('\t')) {
        parts = line.split('\t');
    } else if (line.includes(' | ')) {
        parts = line.split(' | ');
    } else if (line.includes('|')) {
        parts = line.split('|');
    } else {
        parts = line.split(/\s{2,}/);
    }

    parts = parts.map(p => p.trim()).filter(p => p.length > 0);
    if (parts.length < 2) return null;

    return { nome: parts[0], cnpj: parts[1] || '', instagram: parts[2] || '' };
}

async function searchEnrich() {
    const rawText = document.getElementById('items-list-enrich').value;
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length === 0) {
        alert('Cole ao menos uma linha (Nome | CNPJ | Instagram opcional).');
        return;
    }

    const items = lines.map(parseEnrichLine).filter(Boolean);
    if (items.length === 0) {
        alert('Não consegui identificar Nome e CNPJ nas linhas informadas.');
        return;
    }

    const btn = document.getElementById('btn-enrich-search');
    const loading = document.getElementById('enrich-loading');
    const resultsSection = document.getElementById('enrich-results-section');
    const tableBody = document.getElementById('enrich-table-body');

    btn.disabled = true;
    loading.style.display = 'block';
    resultsSection.style.display = 'none';
    tableBody.innerHTML = '';

    try {
        const response = await fetch('/api/enrich/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });

        const data = await response.json();
        if (data.error) {
            alert('Erro: ' + data.error);
            return;
        }

        renderEnrichResults(data);
        resultsSection.style.display = 'block';
    } catch (e) {
        console.error('Erro no Enriquecimento:', e);
        alert('Erro ao processar a busca. Verifique o console.');
    } finally {
        loading.style.display = 'none';
        btn.disabled = false;
    }
}

function renderEnrichResults(results) {
    const tableBody = document.getElementById('enrich-table-body');
    tableBody.innerHTML = '';

    if (results.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="12" style="text-align:center; padding: 2rem; color: var(--text-muted);">Nenhum resultado encontrado.</td></tr>';
        return;
    }

    results.forEach(res => {
        const tr = document.createElement('tr');

        const googleNameHtml = `<div style="font-weight: 700; color: var(--merkos-red); font-size: 1rem;">${res.google.nome}</div>`;

        const ruaNumero = res.google.rua_numero && res.google.rua_numero !== 'N/A' ? res.google.rua_numero : '-';
        const enderecoCompleto = res.google.cep && res.google.cep !== 'N/A' ? `${ruaNumero}, CEP: ${res.google.cep}` : ruaNumero;
        const addressHtml = `<div style="font-size: 0.8125rem; color: var(--text-main); font-weight: 500;">${enderecoCompleto}</div>`;

        const cidadeHtml = res.google.cidade && res.google.cidade !== 'N/A' ? res.google.cidade : '-';
        const estadoHtml = res.google.estado && res.google.estado !== 'N/A' ? res.google.estado : '-';
        const paisHtml = res.google.pais && res.google.pais !== 'N/A' ? res.google.pais : '-';
        const telefoneHtml = res.google.telefone && res.google.telefone !== 'N/A' ? res.google.telefone : '-';

        const cnpjHtml = res.biz.cnpj !== 'Não encontrado' ? `
            <div style="font-weight: 700; font-size: 0.875rem;">${formatCNPJ(res.biz.cnpj)}</div>
        ` : `<span class="chip chip-gray">N/A</span>`;

        const razaoHtml = res.biz.razao_social && res.biz.razao_social !== 'N/A' ? `
            <div style="font-weight: 600; font-size: 0.875rem; color: var(--text-main);">${res.biz.razao_social}</div>
        ` : `<span class="chip chip-gray">Não localizada</span>`;

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

        const websiteHtml = res.google.website && res.google.website !== 'N/A' ? `
            <a href="${res.google.website}" target="_blank" style="font-size: 0.8125rem; word-break: break-all;">${res.google.website}</a>
        ` : '-';

        const instagramBadge = res.google.instagramFonte === 'busca_ativa'
            ? `<span class="chip chip-gray" style="font-size: 0.6rem; padding: 0.1rem 0.4rem; margin-left: 6px; vertical-align: middle;" title="Encontrado por busca ativa (Google), não cadastrado no Google Maps — confira antes de usar">busca ativa</span>`
            : '';
        const instagramHtml = res.google.instagramUrl && res.google.instagramUrl !== 'N/A' ? `
            <a href="${res.google.instagramUrl}" target="_blank" style="font-size: 0.8125rem; word-break: break-all;">${res.google.instagramUrl}</a>${instagramBadge}
        ` : '-';

        const foundingHtml = formatFoundingDate(res.biz.data_abertura);

        tr.innerHTML = `
            <td>${googleNameHtml}</td>
            <td style="min-width: 200px;">${addressHtml}</td>
            <td>${cidadeHtml}</td>
            <td>${estadoHtml}</td>
            <td>${paisHtml}</td>
            <td>${telefoneHtml}</td>
            <td>${cnpjHtml}</td>
            <td>${razaoHtml}</td>
            <td style="max-width: 320px;">${deepHtml}</td>
            <td style="max-width: 200px;">${websiteHtml}</td>
            <td style="max-width: 200px;">${instagramHtml}</td>
            <td>${foundingHtml}</td>
        `;
        tableBody.appendChild(tr);
    });

    window.lastEnrichResults = results;
}

function exportEnrichCSV() {
    if (!window.lastEnrichResults || window.lastEnrichResults.length === 0) return;

    let csv = 'Nome do Negócio;Endereço;Cidade;Estado;País;Telefone (Google);CNPJ;Razão Social;Sócios;Telefones Live;Website;Instagram;Dia de Fundação\n';
    window.lastEnrichResults.forEach(res => {
        const sociosStr = (res.deep.socios || []).map(s => `${s.nome} (${s.fim})`).join(' | ');
        const telsList = [];
        (res.deep.socios || []).forEach(s => (s.telefones || []).forEach(t => {
            let prefix = t.estrela ? '⭐ ' : t.check ? '✅ ' : '';
            telsList.push(`${prefix}${t.display} (${s.nome.split(' ')[0]})`);
        }));

        const ruaNumero = res.google.rua_numero && res.google.rua_numero !== 'N/A' ? res.google.rua_numero : '';
        const enderecoCompleto = res.google.cep && res.google.cep !== 'N/A' ? `${ruaNumero}, CEP: ${res.google.cep}` : ruaNumero;

        const row = [
            res.google.nome,
            enderecoCompleto,
            res.google.cidade || 'N/A',
            res.google.estado || 'N/A',
            res.google.pais || 'N/A',
            res.google.telefone || 'N/A',
            formatCNPJ(res.biz.cnpj),
            res.biz.razao_social || 'N/A',
            sociosStr,
            telsList.join(' | '),
            res.google.website || 'N/A',
            res.google.instagramUrl || 'N/A',
            formatFoundingDate(res.biz.data_abertura)
        ].map(val => `"${(val || '').toString().replace(/"/g, '""')}"`);

        csv += row.join(';') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `enriquecimento_cnpj_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

window.searchEnrich = searchEnrich;
window.exportEnrichCSV = exportEnrichCSV;
