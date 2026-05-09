async function searchBiz() {
    const namesText = document.getElementById('companies-list-biz').value;
    const c = document.getElementById('city-biz').value;
    const s = document.getElementById('state-biz').value;
    const segment = document.getElementById('segment-biz').value;

    if (!namesText.trim()) return alert('Insira pelo menos uma empresa na lista.');

    // UI Elements
    const loading = document.getElementById('loading-biz');
    const resultsSection = document.getElementById('results-section-biz');
    const resBody = document.getElementById('res-body-biz');
    const resCount = document.getElementById('res-count-biz');

    // UI Reset
    loading.style.display = 'block';
    resultsSection.style.display = 'none';
    resBody.innerHTML = '';

    // 1. Coleta e Normalização inicial das linhas
    const rawLines = namesText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // 2. Parsing e Deduplicação Lógica
    const searchTasks = [];
    const seenTasks = new Set();

    for (const line of rawLines) {
        let currentName = "";
        let currentAddress = "";

        const addrRegex = /\s(rua|r\.|av\.|avenida|rod\.|rodovia|travessa|pça|praça|alameda|servidão|estrada)\b/i;
        const match = line.match(addrRegex);

        if (match) {
            const splitIndex = match.index;
            currentName = line.substring(0, splitIndex).trim();
            currentAddress = line.substring(splitIndex).trim();
        } else {
            if (line.includes('\t')) {
                [currentName, currentAddress] = line.split('\t').map(x => x.trim());
            } else if (line.includes(' | ')) {
                [currentName, currentAddress] = line.split(' | ').map(x => x.trim());
            } else if (line.includes('   ')) {
                const parts = line.split(/\s{3,}/);
                currentName = parts[0].trim();
                currentAddress = parts[1] ? parts[1].trim() : "";
            } else if (line.includes(' - ')) {
                const parts = line.split(' - ');
                if (parts[1] && (parts[1].toLowerCase().includes('rua') || /\d+/.test(parts[1]))) {
                    currentName = parts[0].trim();
                    currentAddress = parts.slice(1).join(' - ').trim();
                }
            } else {
                currentName = line.trim();
            }
        }

        currentName = currentName.replace(/[|;\-,]$/, '').trim();
        const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const taskKey = `${norm(currentName)}|${norm(currentAddress)}`;

        if (!seenTasks.has(taskKey) && currentName.length > 2) {
            seenTasks.add(taskKey);
            searchTasks.push({ name: currentName, address: currentAddress });
        }
    }

    let ibgeCode = null;
    if (c && s) {
        try {
            const ibgeRes = await fetch(`/api/ibge/${c}/${s}`);
            const ibge = await ibgeRes.json();
            if (ibge.codigo_ibge) ibgeCode = ibge.codigo_ibge;
        } catch (e) {
            console.warn('Erro ao buscar IBGE:', e.message);
        }
    }

    let totalFoundCount = 0;

    for (let i = 0; i < searchTasks.length; i++) {
        const { name: currentName, address: currentAddress } = searchTasks[i];

        try {
            if (i > 0) await new Promise(r => setTimeout(r, 800));

            const resRaw = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: currentName,
                    address_query: currentAddress,
                    segment: segment,
                    city_name: c,
                    city_ibge: ibgeCode,
                    state: s,
                    use_mock: false
                })
            });
            const res = await resRaw.json();

            if (res.data && res.data.length > 0) {
                totalFoundCount++;
                res.data.forEach(emp => {
                    const row = document.createElement('tr');

                    let auditHtml = "";
                    if (emp.audit) {
                        auditHtml = `
                            <div style="font-size: 10px; margin-top: 8px; color: var(--text-muted);">
                                <b>Match Audit:</b> End:${emp.audit.address} | Bairro:${emp.audit.district} | Seg:${emp.audit.segment} | Nome:${emp.audit.name}
                            </div>
                        `;
                    }

                    row.innerHTML = `
                        <td>
                            <div style="font-weight:600; color:var(--merkos-red);">${currentName}</div>
                            <div style="font-size:0.75rem; color:var(--text-muted);">${currentAddress || 'Endereço não informado'}</div>
                        </td>
                        <td>
                            <div style="font-weight:600;">${emp.razao_social || '-'}</div>
                            <div style="font-size:0.8125rem;">CNPJ: ${formatCNPJ(emp.cnpj)}</div>
                            ${auditHtml}
                        </td>
                        <td>${emp.cidade || c || '-'} / ${emp.uf || s || '-'}</td>
                        <td><span class="chip ${emp.score >= 120 ? 'chip-green' : 'chip-blue'}">${emp.score || 0} pts</span></td>
                    `;
                    resBody.appendChild(row);
                });
            } else {
                const row = document.createElement('tr');
                row.style.background = '#fff8f8';
                row.innerHTML = `
                    <td>
                        <div style="font-weight:600;">${currentName}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted);">${currentAddress}</div>
                    </td>
                    <td colspan="3" style="color: var(--text-muted); font-style: italic;">Nenhum match com score suficiente encontrado.</td>
                `;
                resBody.appendChild(row);
            }
        } catch (e) {
            console.error(`Erro em "${currentName}":`, e);
        }
    }

    loading.style.display = 'none';
    resultsSection.style.display = 'block';
    resCount.innerText = `${totalFoundCount} empresa(s) localizada(s)`;
}

function formatCNPJ(cnpj) {
    if (!cnpj) return '-';
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function exportCSVBiz() {
    const rows = Array.from(document.querySelectorAll('#res-body-biz tr'));
    if (rows.length === 0) return alert('Sem dados para exportar.');

    let csv = 'Termo;CNPJ;Razao Social;Localizacao;Score\n';
    rows.forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length < 4) return;

        const termo = tds[0].innerText.replace(/\n/g, ' - ');
        const razao = tds[1].innerText.replace(/\n/g, ' - ');
        const local = tds[2].innerText;
        const score = tds[3].innerText;

        csv += `"${termo}";"${razao}";"${local}";"${score}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `cnpj_biz_results_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

window.searchBiz = searchBiz;
window.exportCSVBiz = exportCSVBiz;
