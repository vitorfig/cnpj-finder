// Ported from the script section of google_places.html

const estados = {
    'AC': 'Acre', 'AL': 'Alagoas', 'AP': 'Amapá', 'AM': 'Amazonas',
    'BA': 'Bahia', 'CE': 'Ceará', 'DF': 'Distrito Federal', 'ES': 'Espírito Santo',
    'GO': 'Goiás', 'MA': 'Maranhão', 'MT': 'Mato Grosso', 'MS': 'Mato Grosso do Sul',
    'MG': 'Minas Gerais', 'PA': 'Pará', 'PB': 'Paraíba', 'PR': 'Paraná',
    'PE': 'Pernambuco', 'PI': 'Piauí', 'RJ': 'Rio de Janeiro', 'RN': 'Rio Grande do Norte',
    'RS': 'Rio Grande do Sul', 'RO': 'Rondônia', 'RR': 'Roraima', 'SC': 'Santa Catarina',
    'SP': 'São Paulo', 'SE': 'Sergipe', 'TO': 'Tocantins'
};

function initGoogleSearch() {
    const estadoSelect = document.getElementById('estado');
    const citiesContainer = document.getElementById('citiesContainer');
    const selectAllBtn = document.getElementById('selectAll');
    const deselectAllBtn = document.getElementById('deselectAll');
    const selectedCountSpan = document.getElementById('selectedCount');
    const form = document.getElementById('searchForm');
    const btnSearch = document.getElementById('btnSearch');
    const loading = document.getElementById('loading');
    const loadingText = document.getElementById('loadingText');
    const progressInfo = document.getElementById('progressInfo');
    const emptyState = document.getElementById('emptyState') || { style: {}, innerHTML: '' };
    const tableContainer = document.getElementById('tableContainer');
    const tableBody = document.getElementById('tableBody');
    const resultsCount = document.getElementById('resultsCount');
    const errorMessage = document.getElementById('errorMessage');

    // Preencher select de estados
    if (estadoSelect.options.length <= 1) {
        Object.entries(estados).sort((a, b) => a[1].localeCompare(b[1])).forEach(([sigla, nome]) => {
            const option = document.createElement('option');
            option.value = sigla;
            option.textContent = nome;
            estadoSelect.appendChild(option);
        });
    }

    // Ao selecionar estado, buscar cidades via API do IBGE
    estadoSelect.addEventListener('change', async () => {
        const uf = estadoSelect.value;
        if (!uf) {
            citiesContainer.innerHTML = '<p style="color: var(--text-muted); grid-column: 1/-1; text-align: center;">Selecione um estado para ver as cidades</p>';
            updateSelectedCount();
            return;
        }

        citiesContainer.innerHTML = '<p style="color: var(--text-muted); grid-column: 1/-1; text-align: center;">Carregando cidades...</p>';

        try {
            const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
            const cidades = await response.json();

            citiesContainer.innerHTML = '';
            cidades.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(cidade => {
                const label = document.createElement('label');
                label.className = 'city-box';
                label.innerHTML = `
                    <input type="checkbox" value="${cidade.nome}" data-id="${cidade.id}">
                    <span>${cidade.nome}</span>
                `;
                citiesContainer.appendChild(label);
            });

            // Listener para checkboxes
            citiesContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.addEventListener('change', updateSelectedCount);
            });

            updateSelectedCount();
        } catch (error) {
            citiesContainer.innerHTML = '<p style="color: #ef4444; grid-column: 1/-1; text-align: center;">Erro ao carregar cidades</p>';
        }
    });

    function updateSelectedCount() {
        const checked = citiesContainer.querySelectorAll('input[type="checkbox"]:checked').length;
        selectedCountSpan.textContent = `${checked} selecionada${checked !== 1 ? 's' : ''}`;
    }

    // Funções de UI
    function uiSearchStart() {
        loading.style.display = 'block';
        tableContainer.style.display = 'none';
        emptyState.style.display = 'none';
        errorMessage.style.display = 'none';
        btnSearch.disabled = true;
        progressInfo.textContent = 'Iniciando busca em grid geográfico...';
    }

    function uiSearchEnd() {
        loading.style.display = 'none';
        btnSearch.disabled = false;
    }

    // Evento de busca
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const uf = estadoSelect.value;
        const segment = document.getElementById('segment-google').value;
        const limit = parseInt(document.getElementById('limit-google').value) || 0;
        const selectedCidades = Array.from(citiesContainer.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);

        if (!uf || !segment || selectedCidades.length === 0) {
            alert('Por favor, selecione um estado, informe o segmento e marque pelo menos uma cidade.');
            return;
        }

        uiSearchStart();

        try {
            const response = await fetch('/api/google/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    estado: uf,
                    cidades: selectedCidades,
                    segment: segment,
                    limit: limit
                })
            });

            const data = await response.json();

            if (data.error) {
                errorMessage.textContent = data.error;
                errorMessage.style.display = 'block';
            } else {
                renderResults(data.results, data.info);
            }
        } catch (error) {
            errorMessage.textContent = 'Erro de conexão com o servidor. Tente novamente.';
            errorMessage.style.display = 'block';
            console.error(error);
        } finally {
            uiSearchEnd();
        }
    });

    function renderResults(results, info) {
        if (!results || results.length === 0) {
            emptyState.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 48px; opacity: 0.3;">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                </svg>
                <p style="margin-top: 1rem;">Nenhum lugar encontrado nesta região.</p>
            `;
            emptyState.style.display = 'block';
            tableContainer.style.display = 'none';
            resultsCount.textContent = '0 lugares mapeados';
            return;
        }

        tableBody.innerHTML = '';

        results.forEach(place => {
            const row = document.createElement('tr');

            row.innerHTML = `
                <td>
                    <div style="font-weight: 700; color: var(--merkos-red);">${escapeHtml(place.nome)}</div>
                </td>
                <td style="font-size: 0.8125rem;">${escapeHtml(place.endereco)}</td>
                <td>${formatValue(place.telefone)}</td>
                <td style="display: flex; flex-direction: column; gap: 4px;">
                    ${formatWebsite(place.website)}
                    ${place.instagram !== 'N/A' ? `<a href="https://instagram.com/${place.instagram.replace('@', '')}" target="_blank" class="secondary-btn" style="background:#fee2e2; color:#b91c1c; text-align:center;">📸 @${place.instagram.replace('@', '')}</a>` : ''}
                </td>
            `;

            tableBody.appendChild(row);
        });

        let countText = `${results.length} LUGARES MAPEADOS`;
        if (info && info.cidades_processadas) {
            countText += ` EM ${info.cidades_processadas} CIDADES`;
        }
        resultsCount.textContent = countText;
        emptyState.style.display = 'none';
        tableContainer.style.display = 'block';
    }

    function escapeHtml(text) {
        if (!text || text === 'N/A') return '<span class="chip chip-gray">N/A</span>';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatValue(value) {
        if (!value || value === 'N/A') {
            return '<span class="chip chip-gray">N/A</span>';
        }
        return `<b>${escapeHtml(value)}</b>`;
    }

    function formatWebsite(url) {
        if (!url || url === 'N/A') {
            return '<span class="chip chip-gray">N/A</span>';
        }
        const displayUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        return `<a href="${url}" target="_blank" class="secondary-btn" style="text-align:center;">🌐 ${displayUrl}</a>`;
    }
}

// Global scope if needed or just call init
window.initGoogleSearch = initGoogleSearch;
