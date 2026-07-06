require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;
const CNPJ_BIZ_TOKEN = process.env.CNPJ_BIZ_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const USE_MOCK = process.env.USE_MOCK === 'true';
const AUTH_EMAIL = process.env.AUTH_EMAIL;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

// --- AUTENTICAÇÃO (sessão via cookie assinado, sem dependências extras) ---
function parseCookies(header) {
    const out = {};
    if (!header) return out;
    header.split(';').forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx === -1) return;
        out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    });
    return out;
}

function signSession(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
    return `${data}.${sig}`;
}

function verifySession(token) {
    if (!token) return null;
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
        if (!payload.exp || payload.exp < Date.now()) return null;
        return payload;
    } catch {
        return null;
    }
}

const PUBLIC_PATHS = new Set(['/login.html', '/api/login']);

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    if (PUBLIC_PATHS.has(req.path) || req.path.startsWith('/Logos')) return next();
    const { session } = parseCookies(req.headers.cookie);
    if (!verifySession(session)) {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Não autenticado' });
        return res.redirect('/login.html');
    }
    next();
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body || {};
    const emailBuf = Buffer.from(String(email || ''));
    const authEmailBuf = Buffer.from(AUTH_EMAIL);
    const emailOk = emailBuf.length === authEmailBuf.length && crypto.timingSafeEqual(emailBuf, authEmailBuf);

    const passBuf = Buffer.from(String(password || ''));
    const authPassBuf = Buffer.from(AUTH_PASSWORD);
    const passOk = passBuf.length === authPassBuf.length && crypto.timingSafeEqual(passBuf, authPassBuf);

    if (!emailOk || !passOk) return res.status(401).json({ error: 'E-mail ou senha inválidos' });

    const token = signSession({ email, exp: Date.now() + SESSION_MAX_AGE_MS });
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=Lax`);
    res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
    res.json({ ok: true });
});

app.use(express.static('public'));
app.use('/Logos', express.static(path.join(__dirname, 'Logos')));

// --- COST TRACKING (logging only, no global limit) ---
let globalPaidCreditsSpent = 0;
// Regra: cada empresa gasta 1 busca grátis (contar) + máx 1 crédito pago (listar-com-dados)

// Última falha conhecida do CNPJ.biz ao tentar enriquecimento pago (ex: sem créditos).
// Persistida em disco para sobreviver a reinícios do servidor.
const CNPJ_BIZ_STATUS_FILE = path.join(__dirname, '.cnpj_biz_status.json');
let cnpjBizLastPaidError = null;
try {
    cnpjBizLastPaidError = JSON.parse(fs.readFileSync(CNPJ_BIZ_STATUS_FILE, 'utf8')).lastPaidError;
} catch { /* sem cache ainda */ }

function setCnpjBizLastPaidError(value) {
    cnpjBizLastPaidError = value;
    try {
        fs.writeFileSync(CNPJ_BIZ_STATUS_FILE, JSON.stringify({ lastPaidError: value }));
    } catch { /* falha ao persistir, segue só em memória */ }
}


// --- GOOGLE PLACES LOGIC (Ported from Python) ---

async function getCityCoordinates(city) {
    const url = "https://maps.googleapis.com/maps/api/geocode/json";
    try {
        const response = await axios.get(url, {
            params: {
                address: city,
                key: GOOGLE_API_KEY,
                language: "pt-BR"
            }
        });
        const data = response.data;
        if (data.status !== "OK" || !data.results || data.results.length === 0) return null;

        const result = data.results[0];
        const { location, viewport } = result.geometry;
        return { lat: location.lat, lng: location.lng, viewport };
    } catch (e) {
        console.error("  [Geocoding] Exception:", e.message);
        return null;
    }
}

function calculateGrid(viewport, maxPontos = 16) {
    const { northeast, southwest } = viewport;
    const latMax = northeast.lat;
    const latMin = southwest.lat;
    const lngMax = northeast.lng;
    const lngMin = southwest.lng;

    const latDiff = Math.abs(latMax - latMin);
    const lngDiff = Math.abs(lngMax - lngMin);
    const areaKm = (latDiff * 111) * (lngDiff * 111);

    let gridSize;
    if (areaKm < 100) gridSize = 2;
    else if (areaKm < 500) gridSize = 3;
    else if (areaKm < 2000) gridSize = 4;
    else gridSize = 5;

    gridSize = Math.min(gridSize, Math.floor(Math.sqrt(maxPontos)));

    const pontos = [];
    const latStep = latDiff / (gridSize + 1);
    const lngStep = lngDiff / (gridSize + 1);

    for (let i = 1; i <= gridSize; i++) {
        for (let j = 1; j <= gridSize; j++) {
            pontos.push({
                lat: latMin + (latStep * i),
                lng: lngMin + (lngStep * j)
            });
        }
    }

    let raio = Math.floor(Math.max(latStep, lngStep) * 111 * 1000 * 0.7);
    raio = Math.min(raio, 50000);
    raio = Math.max(raio, 5000);

    return { pontos, raio, gridSize };
}

async function searchNearby(lat, lng, raio, keyword) {
    const url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
    let lugares = [];
    let pageCount = 0;
    const maxPages = 3;
    let nextToken = null;

    try {
        while (pageCount < maxPages) {
            const params = {
                location: `${lat},${lng}`,
                radius: raio,
                keyword: keyword,
                key: GOOGLE_API_KEY,
                language: "pt-BR"
            };
            if (nextToken) params.pagetoken = nextToken;

            const response = await axios.get(url, { params });
            const data = response.data;

            if (data.status !== "OK" && data.status !== "ZERO_RESULTS") break;

            if (data.results) {
                data.results.forEach(place => {
                    lugares.push({
                        place_id: place.place_id,
                        nome: place.name || "N/A",
                        endereco: place.vicinity || "N/A",
                        types: place.types || []
                    });
                });
            }

            pageCount++;
            nextToken = data.next_page_token;
            if (!nextToken) break;

            await new Promise(r => setTimeout(r, 2000));
        }
        return lugares;
    } catch (e) {
        return [];
    }
}

async function getPlaceDetails(placeId) {
    const url = "https://maps.googleapis.com/maps/api/place/details/json";
    try {
        const response = await axios.get(url, {
            params: {
                place_id: placeId,
                key: GOOGLE_API_KEY,
                fields: "formatted_phone_number,website,formatted_address",
                language: "pt-BR"
            }
        });
        const result = response.data.result || {};
        return {
            telefone: result.formatted_phone_number || "N/A",
            website: result.website || "N/A",
            endereco_completo: result.formatted_address || "N/A"
        };
    } catch (e) {
        return {};
    }
}

function extractInstagram(website) {
    if (!website || website === "N/A") return "N/A";
    const match = website.toLowerCase().match(/instagram\.com\/([^/?]+)/);
    return match ? `@${match[1]}` : "N/A";
}

const PALAVRAS_EXCLUIR = [
    'clube', 'club', 'loja', 'decathlon', 'federação', 'federacion', 'federation',
    'instituto', 'construtora', 'residencial', 'condomínio', 'condominio',
    'shopping', 'mall', 'magazine', 'aula de tenis', 'aula de tênis',
    'escola de tenis', 'escola de tênis', 'fit a be', 'fitabe',
    'pública', 'publica', 'público', 'publico'
];

const TIPOS_EXCLUIR = [
    'store', 'clothing_store', 'shoe_store', 'sporting_goods_store',
    'department_store', 'furniture_store', 'home_goods_store',
    'real_estate_agency', 'insurance_agency', 'travel_agency',
    'car_dealer', 'car_rental', 'car_repair'
];

function shouldExclude(nome, types) {
    const nomeLower = (nome || "").toLowerCase();
    if (PALAVRAS_EXCLUIR.some(p => nomeLower.includes(p))) return true;
    if (types && types.some(t => TIPOS_EXCLUIR.includes(t))) return true;
    return false;
}

// Configurações Big Data Corp (Deep Search)
const BDC_HEADERS = {
    'AccessToken': process.env.BDC_ACCESS_TOKEN,
    'TokenId': process.env.BDC_TOKEN_ID,
    'Content-Type': 'application/json'
};

function normalize(str) {
    return str ? str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() : '';
}

// Motor de Filtro e Ranking Inteligente (Address-Aware)
function processCandidate(emp, queryName, queryAddress, segment) {
    const nameFull = normalize((emp.razao_social || '') + ' ' + (emp.nome_fantasia || ''));
    const empEnd = emp.endereco || {};
    const empStreet = normalize(empEnd.logradouro || '');
    const empNum = (empEnd.numero || '').toString().trim();

    const activities = emp.atividades_economicas ? emp.atividades_economicas.map(a => normalize(a.descricao)).join(' ') : '';
    const normSeg = normalize(segment);
    const normQuery = normalize(queryName);
    const normAddr = normalize(queryAddress);

    let score = 0;
    let breakdown = { address: 0, segment: 0, name: 0, district: 0 };

    // 1. MATCH DE ENDEREÇO
    if (normAddr) {
        const addrParts = queryAddress.split(/[,–-]/).map(p => normalize(p));
        const qStreet = addrParts[0] || "";
        const qDistrict = addrParts[2] || (addrParts.length > 2 ? addrParts[addrParts.length - 1] : "");

        const streetWords = qStreet.split(/\s+/).filter(w => w.length > 2 && !['rua', 'avenida', 'alameda', 'estrada'].includes(w));
        const districtWords = qDistrict.split(/\s+/).filter(w => w.length > 2);

        const streetMatch = streetWords.length > 0 && streetWords.some(word => empStreet.includes(word));
        const districtMatch = districtWords.length > 0 &&
            (normalize(emp.endereco?.bairro || "").includes(qDistrict) ||
                districtWords.some(w => normalize(emp.endereco?.bairro || "").includes(w)));

        const addrNumMatch = normAddr.match(/\d+/);
        const queryNum = addrNumMatch ? addrNumMatch[0] : null;

        if (streetMatch) breakdown.address += 300;
        if (districtMatch) breakdown.district += 50;
        if (queryNum && empNum === queryNum) breakdown.address += 50;
    }

    // 2. FILTRO DE BLACKLIST
    const blacklist = ['cartorio', 'notarial', 'notario', 'notaria', 'registrad', 'sindicato', 'confederacao', 'ministerio', 'prefeitura'];
    if (blacklist.some(term => nameFull.includes(term))) {
        score -= 200;
    }

    // 3. MATCH DE SEGMENTO
    if (normSeg) {
        let segWords = normSeg.split(/\s+/).filter(w => w.length > 2);
        const thematicKeywords = ['esporte', 'esportiv', 'lazer', 'academia', 'clube', 'sports', 'arena', 'tennis', 'tenis', 'beach'];

        const isThematic = thematicKeywords.some(tk => nameFull.includes(tk) || activities.includes(tk));
        const matchCNAE = segWords.some(w => activities.includes(w));
        const matchName = segWords.some(w => nameFull.includes(w));

        if (isThematic) breakdown.segment += 150;
        if (matchCNAE) breakdown.segment += 100;
        if (matchName) breakdown.segment += 50;
    }

    // 4. PONTUAÇÃO POR NOME
    const queryWords = normQuery.split(/\s+/).filter(w => w.length > 2);
    queryWords.forEach(word => {
        if (nameFull.includes(word)) breakdown.name += 30;
    });

    if (nameFull.includes(normQuery)) breakdown.name += 100;

    score += (breakdown.address + breakdown.district + breakdown.segment + breakdown.name);

    return { pass: true, score, breakdown };
}

app.get('/api/ibge/:city/:state', async (req, res) => {
    try {
        const { city, state } = req.params;
        const response = await axios.get(`https://brasilapi.com.br/api/ibge/municipios/v1/${state}`);
        const inputNormalized = normalize(city);
        const founding = response.data.find(m => normalize(m.nome) === inputNormalized);
        res.json({ codigo_ibge: founding ? founding.codigo_ibge : null, nome: founding ? founding.nome : null });
    } catch (e) { res.json({ codigo_ibge: null }); }
});

// --- REUSABLE LOGIC FUNCTIONS ---

async function runGoogleSearch(estado, cidades, segment, limit = 0) {
    let allResults = [];
    let excluidos = 0;

    for (const cidade of cidades) {
        if (limit > 0 && allResults.length >= limit) break;
        try {
            const cidadeCompleta = `${cidade}, ${estado}, Brasil`;
            const coords = await getCityCoordinates(cidadeCompleta);
            if (!coords) continue;

            const { pontos, raio } = calculateGrid(coords.viewport);

            for (const p of pontos) {
                const places = await searchNearby(p.lat, p.lng, raio, segment);
                for (const place of places) {
                    if (limit > 0 && allResults.length >= limit) break;

                    if (shouldExclude(place.nome, place.types || [])) {
                        excluidos++;
                        continue;
                    }
                    if (allResults.some(r => r.place_id === place.place_id)) continue;

                    const details = await getPlaceDetails(place.place_id);
                    const fullAddress = details.endereco_completo || place.endereco;

                    const normAddress = normalize(fullAddress);
                    const cityMatch = cidades.some(c => normAddress.includes(normalize(c)));

                    if (!cityMatch) {
                        excluidos++;
                        continue;
                    }

                    allResults.push({
                        nome: place.nome,
                        endereco: fullAddress,
                        telefone: details.telefone || 'N/A',
                        website: details.website || 'N/A',
                        instagram: extractInstagram(details.website),
                        place_id: place.place_id,
                        types: place.types || []
                    });

                    if (limit > 0 && allResults.length >= limit) break;
                }
                if (limit > 0 && allResults.length >= limit) break;
            }
        } catch (e) {
            console.error(`Erro na cidade ${cidade}:`, e.message);
        }
    }
    return { results: allResults, info: { total_cidades: cidades.length, excluidos: excluidos } };
}

/**********************************************************************************
 * ⚠️ ATENÇÃO - REGRAS DE CUSTO (CNPJ BIZ) - NÃO ALTERAR SEM APROVAÇÃO ⚠️
 * 
 * 1. DESCOBERTA (Discovery): Use APENAS o endpoint '/empresas/contar'.
 *    - Este endpoint é GRATUITO (não consome créditos).
 * 
 * 2. ENRIQUECIMENTO (Enrichment): Use o endpoint '/empresas/listar-com-dados'.
 *    - Este endpoint é PAGO (1 CRÉDITO POR RESULTADO).
 *    - Usa APENAS razao_fantasia para discovery (razao_social retorna totais da cidade)
 *    - Se discovery falha, tenta enriquecimento pago direto (1 crédito por empresa)
 **********************************************************************************/

function getNameVariations(name) {
    if (!name) return [];
    const variations = [];
    const cleanName = name.trim().toUpperCase();
    variations.push(cleanName);

    // Numeral-to-word expansions (common Brazilian brand abbreviations)
    const numeralMap = {
        'I9': 'INOVE', 'K2': 'KADOIS', '3R': 'TRESERRE',
        'S2': 'SDOIS', 'R7': 'RSETE', 'G8': 'GOITO',
        'V8': 'VOITO', 'B2': 'BDOIS', 'T4': 'TQUATRO'
    };

    // Try expanding numerals in the name
    let expandedName = cleanName;
    for (const [abbrev, expanded] of Object.entries(numeralMap)) {
        if (cleanName.includes(abbrev)) {
            expandedName = cleanName.replace(abbrev, expanded);
            variations.push(expandedName);
            // Also add just the expanded word + rest of name words
            const expandedWords = expandedName.split(/\s+/);
            if (expandedWords.length > 1) {
                variations.push(expandedWords.slice(0, 2).join(" "));
            }
            variations.push(expandedWords[0]);
        }
    }

    // Remove common suffixes
    const suffixes = [" LTDA", " EIRELI", " S/A", " ME", " EPP", " COMERCIO", " SERVICOS"];
    let stripped = cleanName;
    suffixes.forEach(s => {
        if (stripped.endsWith(s)) stripped = stripped.substring(0, stripped.length - s.length).trim();
    });
    if (stripped !== cleanName) variations.push(stripped);

    const words = stripped.split(/\s+/);

    // First word (core brand name)
    if (words.length > 1 && words[0].length > 2) {
        variations.push(words[0]);
    }

    // First 2 and 3 words
    if (words.length > 2) {
        variations.push(words.slice(0, 2).join(" "));
        if (words.length > 3) variations.push(words.slice(0, 3).join(" "));
    }

    // Acronym-with-dots expansion: FTM → F.T.M, F.T.M., F.TM, F.TM.
    // Detect if first word looks like an acronym (2-5 uppercase letters, no vowels or very short)
    const firstWord = words[0];
    if (firstWord && firstWord.length >= 2 && firstWord.length <= 5 && /^[A-Z]+$/.test(firstWord)) {
        // Add dotted version: FTM → F.T.M and F.T.M.
        const dotted = firstWord.split('').join('.');
        variations.push(dotted); // F.T.M
        variations.push(dotted + '.'); // F.T.M.
        // Also try with rest of name
        if (words.length > 1) {
            const rest = words.slice(1).join(" ");
            variations.push(dotted + ' ' + rest);
            variations.push(dotted + '. ' + rest);
        }
    }

    return [...new Set(variations)];
}

async function runBizSearchForCompany(name, address_query, segment, city_name, state) {
    console.log(`\n>>> BUSCA CNPJ: "${name}" em ${city_name || '?'}/${state || '?'}`);

    const variations = getNameVariations(name);
    console.log(`   Variações: ${JSON.stringify(variations)}`);

    // --- PHASE 1: DISCOVERY com razao_fantasia APENAS (GRÁTIS) ---
    // razao_fantasia retorna 0 confiável em caso de mismatch
    // razao_social retorna o total da cidade (NÃO CONFIÁVEL)
    console.log("   [Phase 1] Discovery (grátis, razao_fantasia only)...");

    let goldenTarget = null;
    for (const term of variations) {
        const payload = {
            "razao_fantasia": [term],
            "situacao": ["ativa"]
        };
        if (city_name && state) {
            payload.localidades = [{ "tipo": "cidade", "cidade": city_name, "estado": state, "pais": "BR" }];
        } else if (state) {
            payload.localidades = [{ "tipo": "estado", "estado": state, "pais": "BR" }];
        }

        try {
            const discRes = await axios.post('https://cnpj.biz/api/v2/empresas/contar', payload, {
                headers: { 'Authorization': `Bearer ${CNPJ_BIZ_TOKEN}`, 'Content-Type': 'application/json' }
            });

            let rawCount = discRes.data.count || 0;
            const count = (typeof rawCount === 'string') ? parseInt(rawCount.replace(/\./g, '')) : parseInt(rawCount);
            console.log(`   - fantasia "${term}": ${count} resultado(s)`);

            if (count >= 1 && count <= 3) {
                goldenTarget = { term, count, field: "razao_fantasia" };
                break;
            }
        } catch (e) { /* skip */ }
    }

    // --- PHASE 2: ENRICHMENT (PAGO - 1 crédito) ---
    if (goldenTarget) {
        // Discovery encontrou alvo preciso → enriquece com os mesmos filtros
        console.log(`   ✅ Discovery achou: "${goldenTarget.term}" (${goldenTarget.count} resultados)`);
        const result = await enrichCompany(goldenTarget.term, goldenTarget.field, city_name, state, name, address_query, segment);
        if (result) return result;
    }

    // --- PHASE 3: FALLBACK - Enriquecimento direto (PAGO - 1 crédito MAX) ---
    // Tenta só as 2 primeiras variações, para de gastar depois do primeiro crédito
    console.log("   [Phase 3] Fallback: enriquecimento direto (pago, max 1 crédito)...");
    const creditsBefore = globalPaidCreditsSpent;
    for (const term of variations.slice(0, 2)) {
        if (globalPaidCreditsSpent > creditsBefore) break; // Já gastou 1 crédito nesta empresa
        const result = await enrichCompany(term, "razao_fantasia", city_name, state, name, address_query, segment);
        if (result) return result;
    }

    console.log(`   ❌ Nenhum resultado encontrado para "${name}"`);
    return null;
}

async function enrichCompany(term, field, city_name, state, queryName, queryAddress, segment) {
    try {
        const buildEnrichPayload = (withCity) => {
            const payload = { [field]: [term], "limit": 3, "situacao": ["ativa"] };
            if (withCity && city_name && state) {
                payload.localidades = [{ "tipo": "cidade", "cidade": city_name, "estado": state, "pais": "BR" }];
            } else if (state) {
                payload.localidades = [{ "tipo": "estado", "estado": state, "pais": "BR" }];
            }
            return payload;
        };

        let enrichRes = await axios.post('https://cnpj.biz/api/v2/empresas/listar-com-dados', buildEnrichPayload(true), {
            headers: { 'Authorization': `Bearer ${CNPJ_BIZ_TOKEN}`, 'Content-Type': 'application/json' }
        });
        let firms = enrichRes.data.firms || (Array.isArray(enrichRes.data) ? enrichRes.data : []);

        // CNPJ.biz tem uma inconsistência conhecida: /contar acha resultado com filtro de cidade,
        // mas /listar-com-dados retorna vazio com o mesmo filtro. Tenta de novo só com o estado.
        if (firms.length === 0 && city_name && state) {
            console.log(`   ⚠️ Enriquecimento vazio com filtro de cidade — tentando novamente só com o estado...`);
            enrichRes = await axios.post('https://cnpj.biz/api/v2/empresas/listar-com-dados', buildEnrichPayload(false), {
                headers: { 'Authorization': `Bearer ${CNPJ_BIZ_TOKEN}`, 'Content-Type': 'application/json' }
            });
            firms = enrichRes.data.firms || (Array.isArray(enrichRes.data) ? enrichRes.data : []);
        }

        if (firms.length > 0) {
            globalPaidCreditsSpent++;
            setCnpjBizLastPaidError(null); // chamada paga funcionou, limpa aviso de crédito

            // Score ALL candidates and pick the best one above threshold
            const MIN_SCORE = 50;
            let bestResult = null;
            let bestScore = -1;

            for (const firm of firms) {
                const scored = processCandidate(firm, queryName, queryAddress, segment);
                console.log(`   📊 "${firm.nome_fantasia || firm.razao_social}" (${firm.cnpj}) → Score: ${scored.score} [End:${scored.breakdown.address}|Bairro:${scored.breakdown.district}|Seg:${scored.breakdown.segment}|Nome:${scored.breakdown.name}]`);
                if (scored.score > bestScore) {
                    bestScore = scored.score;
                    bestResult = { firm, scored };
                }
            }

            if (bestResult && bestScore >= MIN_SCORE) {
                console.log(`   ✅ Aceito: "${bestResult.firm.razao_social}" com score ${bestScore}`);
                return {
                    cnpj: bestResult.firm.cnpj,
                    razao_social: bestResult.firm.razao_social,
                    nome_fantasia: bestResult.firm.nome_fantasia,
                    cidade: bestResult.firm.endereco?.cidade?.nome || city_name || 'N/A',
                    data_abertura: bestResult.firm.data_abertura || null,
                    audit: bestResult.scored.breakdown,
                    score: bestResult.scored.score
                };
            } else {
                console.log(`   ⚠️ Rejeitado: score ${bestScore} < ${MIN_SCORE} para "${term}"`);
            }
        }
    } catch (e) {
        setCnpjBizLastPaidError({
            time: new Date().toISOString(),
            message: e.response?.data?.message || e.message
        });
    }
    return null;
}

async function validateLivePhone(ddd, numero, cpf) {
    try {
        const url = "https://plataforma.bigdatacorp.com.br/validacoes/telefones";
        const payload = { "PhoneNumber": `${ddd}${numero}`, "TaxId": cpf };
        const res = await axios.post(url, payload, { headers: BDC_HEADERS });
        const result = res.data.Result || {};
        return {
            titular: result.IsTaxIdMatched || false,
            ativo: result.IsActive || false
        };
    } catch (e) {
        return { titular: false, ativo: false };
    }
}

async function getCpfPhones(cpf, nome) {
    try {
        const url = "https://plataforma.bigdatacorp.com.br/pessoas";
        const payload = { "Datasets": "phones_extended", "q": `doc{${cpf}}` };
        const res = await axios.post(url, payload, { headers: BDC_HEADERS });
        const dados = res.data;

        let listaCelulares = [];
        if (dados.Result && dados.Result.length > 0) {
            const phonesList = (dados.Result[0].ExtendedPhones?.Phones || [])
                .filter(p => String(p.Type || "").toUpperCase() === "MOBILE");

            const validated = await Promise.all(phonesList.map(async p => {
                const ddd = p.AreaCode;
                const num = p.Number;
                const isMain = p.IsMainForEntity || false;
                const passGlobal = p.PhoneGlobalTotalPassages || 0;
                const { titular } = await validateLivePhone(ddd, num, cpf);
                return {
                    display: `+55 (${ddd}) ${num}`,
                    link: `55${ddd}${num}`,
                    estrela: isMain || titular,
                    check: passGlobal > 100,
                    priority: p.Priority || 99
                };
            }));

            listaCelulares = validated.sort((a, b) => {
                if (a.estrela !== b.estrela) return a.estrela ? -1 : 1;
                if (a.check !== b.check) return a.check ? -1 : 1;
                return a.priority - b.priority;
            });
        }
        return listaCelulares;
    } catch (e) {
        return [];
    }
}

async function runDeepSearchForCnpj(cnpj) {
    const cleanCnpj = cnpj.replace(/\D/g, "");
    const payload = {
        "Datasets": "relationships.filter(relationshiptype=QSA),basic_data",
        "q": `doc{${cleanCnpj}}`
    };

    try {
        const bdcRes = await axios.post("https://plataforma.bigdatacorp.com.br/empresas", payload, { headers: BDC_HEADERS });
        const dados = bdcRes.data;

        if (!dados.Result || dados.Result.length === 0) return { empresa: "Não encontrada", socios: [] };

        const basic = dados.Result[0].BasicData || {};
        const nomeEmpresa = basic.OfficialName || basic.TradeName || `CNPJ: ${cnpj}`;

        const relData = dados.Result[0].Relationships || {};
        const current = relData.CurrentRelationships || [];
        const historical = relData.HistoricalRelationships || [];
        const combinada = [...current, ...historical];

        const socios = await Promise.all(combinada.map(async s => {
            const cpf = String(s.RelatedEntityTaxIdNumber || "").replace(/\D/g, "");
            const telefones = cpf ? await getCpfPhones(cpf, s.RelatedEntityName) : [];
            return {
                nome: s.RelatedEntityName || "N/A",
                doc: s.RelatedEntityTaxIdNumber || "N/A",
                cargo: s.RelationshipName || "N/A",
                fim: current.some(curr => curr.RelatedEntityTaxIdNumber === s.RelatedEntityTaxIdNumber) ? "Ativo" : "Histórico",
                telefones: telefones
            };
        }));

        return { empresa: nomeEmpresa, socios: socios };
    } catch (e) {
        console.error(`Erro no Deep Search para CNPJ ${cnpj}:`, e.message);
        return { empresa: "Erro ao consultar", socios: [] };
    }
}

// === ENDPOINTS ORIGINAIS ===

app.post('/api/google/search', async (req, res) => {
    const { estado, cidades, segment, limit } = req.body;
    if (!estado || !cidades || !segment) return res.status(400).json({ error: "Preencha todos os campos", results: [] });

    try {
        const numericLimit = parseInt(limit) || 0;
        const { results, info } = await runGoogleSearch(estado, cidades, segment, numericLimit);
        res.json({ error: null, results: results, info: { cidades_processadas: info.total_cidades, total_cidades: info.total_cidades, excluidos: info.excluidos } });
    } catch (e) { res.status(500).json({ error: e.message, results: [] }); }
});

app.post('/api/search', async (req, res) => {
    const { name, address_query, segment, city_ibge, state, city_name, use_mock } = req.body;
    const shouldMock = (use_mock !== undefined) ? use_mock : USE_MOCK;

    if (shouldMock) {
        try {
            const mockData = fs.readFileSync('mock_data.json', 'utf8');
            const candidates = JSON.parse(mockData);
            const filtered = candidates.map(emp => {
                const result = processCandidate(emp, name, address_query, segment);
                return { ...emp, _score: result.score, _breakdown: result.breakdown };
            }).sort((a, b) => b._score - a._score);
            const winners = filtered.filter(w => w._score >= 120).slice(0, 1);
            const data = winners.map(emp => ({ cnpj: emp.cnpj, razao_social: emp.razao_social, nome_fantasia: emp.nome_fantasia, cidade: emp.endereco?.cidade?.nome || city_name || 'N/A', data_abertura: emp.data_abertura || null, audit: emp._breakdown }));
            return res.json({ data, data_count: data.length, stats: { counts: candidates.length, details: candidates.length }, all_candidates: filtered.map(c => ({ razao: c.razao_social, cnpj: c.cnpj, score: c._score, breakdown: c._breakdown })) });
        } catch (err) { return res.status(500).json({ error: "Erro ao carregar mock data" }); }
    }

    let cityName = city_name || null;
    try {
        const errorBefore = cnpjBizLastPaidError;
        const bizResult = await runBizSearchForCompany(name, address_query, segment, cityName, state);

        let creditError = null;
        if (!bizResult && cnpjBizLastPaidError && cnpjBizLastPaidError !== errorBefore) {
            creditError = cnpjBizLastPaidError.message;
        }

        const data = bizResult ? [{ cnpj: bizResult.cnpj, razao_social: bizResult.razao_social, nome_fantasia: bizResult.nome_fantasia, cidade: bizResult.cidade, data_abertura: bizResult.data_abertura || null, audit: bizResult.audit }] : [];
        res.json({ data, data_count: data.length, stats: { counts: bizResult ? 1 : 0, details: bizResult ? 1 : 0 }, all_candidates: bizResult ? [{ razao: bizResult.razao_social, cnpj: bizResult.cnpj, score: bizResult.score, breakdown: bizResult.audit }] : [], creditError });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/deep/search', async (req, res) => {
    const { cnpjs: cnpjsRaw } = req.body;
    if (!cnpjsRaw) return res.json([]);
    const cnpjs = cnpjsRaw.split('\n').map(c => c.replace(/\D/g, '').trim()).filter(c => c.length > 0);
    const resultados = await Promise.all(cnpjs.map(async cnpj => {
        const deepData = await runDeepSearchForCnpj(cnpj);
        return { cnpj, ...deepData };
    }));
    res.json(resultados);
});

app.post('/api/master/search', async (req, res) => {
    const { estado, cidades, segment, limit, skipList } = req.body;
    if (!estado || !cidades || !segment) return res.status(400).json({ error: "Preencha todos os campos", results: [] });
    const exclusions = (skipList || []).map(s => normalize(s));

    try {
        const { results: googleRawResults } = await runGoogleSearch(estado, cidades, segment);

        // Dedup Google results by place_id
        const seenPlaces = new Set();
        let googleResults = googleRawResults.filter(p => {
            if (seenPlaces.has(p.place_id)) return false;
            seenPlaces.add(p.place_id);
            return true;
        });

        // Skip companies from user exclusion list
        if (exclusions.length > 0) {
            googleResults = googleResults.filter(p => {
                const nomeNorm = normalize(p.nome);
                const isSkipped = exclusions.some(skip => nomeNorm.includes(skip) || skip.includes(nomeNorm));
                if (isSkipped) console.log(`   ⏭️ Pulando "${p.nome}" (lista de exclusão)`);
                return !isSkipped;
            });
        }

        if (limit && limit > 0) googleResults = googleResults.slice(0, limit);

        const finalResults = [];
        const seenCnpjs = new Set(); // Dedup by CNPJ
        for (const place of googleResults) {
            let bizData = null;
            let deepData = { socios: [] };
            const cityFromPlace = cidades.find(c => normalize(place.endereco).includes(normalize(c)));
            bizData = await runBizSearchForCompany(place.nome, place.endereco, segment, cityFromPlace, estado);
            if (bizData && seenCnpjs.has(bizData.cnpj)) {
                console.log(`   🔄 CNPJ duplicado ignorado: ${bizData.cnpj}`);
                bizData = null;
            }
            if (bizData) {
                seenCnpjs.add(bizData.cnpj);
                deepData = await runDeepSearchForCnpj(bizData.cnpj);
            }
            finalResults.push({ google: place, biz: bizData || { cnpj: 'Não encontrado', razao_social: 'N/A' }, deep: deepData });
        }
        res.json(finalResults);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// National-only search: compound-word variants + relaxed enrichment bypassing city filter inconsistency
async function runBizSearchNational(name, address_query, segment, city_name, state) {
    // Phase 1: standard search
    const standard = await runBizSearchForCompany(name, address_query, segment, city_name, state);
    if (standard) return standard;

    // Build compound-word variants (e.g., "ROYAL WAKE PARK" → "ROYAL WAKEPARK")
    const words = name.trim().toUpperCase().split(/\s+/);
    const compoundVariants = [];
    if (words.length >= 2) {
        for (let i = 0; i < words.length - 1; i++) {
            compoundVariants.push([...words.slice(0, i), words[i] + words[i + 1], ...words.slice(i + 2)].join(' '));
        }
    }

    // Phase 2: compound variants via standard search
    for (const variant of compoundVariants) {
        console.log(`   [Nacional] Variação composta: "${variant}"`);
        const result = await runBizSearchForCompany(variant, address_query, segment, city_name, state);
        if (result) return result;
    }

    // Phase 3: direct enrichment for exact single matches (count=1), bypassing city filter
    // CNPJ.biz has inconsistency: contar returns 1 but listar-com-dados returns 0 with city filter
    // Solution: try without city filter (state only) when city-filtered enrichment fails
    const allTerms = [name.trim().toUpperCase(), ...compoundVariants, words[0]].filter((v, i, a) => a.indexOf(v) === i);

    for (const term of allTerms) {
        try {
            // Check count at state level (no city filter — avoids CNPJ.biz city inconsistency)
            const countPayload = { "razao_fantasia": [term], "situacao": ["ativa"] };
            if (state) countPayload.localidades = [{ tipo: "estado", estado: state, pais: "BR" }];

            const countRes = await axios.post('https://cnpj.biz/api/v2/empresas/contar', countPayload, {
                headers: { 'Authorization': `Bearer ${CNPJ_BIZ_TOKEN}`, 'Content-Type': 'application/json' }
            });
            const rawCount = countRes.data.count || 0;
            const count = typeof rawCount === 'string' ? parseInt(rawCount.replace(/\./g, '')) : parseInt(rawCount);
            if (count !== 1) continue;

            const enrichPayload = { "razao_fantasia": [term], "limit": 1, "situacao": ["ativa"] };
            if (state) enrichPayload.localidades = [{ tipo: "estado", estado: state, pais: "BR" }];

            const enrichRes = await axios.post('https://cnpj.biz/api/v2/empresas/listar-com-dados', enrichPayload, {
                headers: { 'Authorization': `Bearer ${CNPJ_BIZ_TOKEN}`, 'Content-Type': 'application/json' }
            });
            const firms = enrichRes.data.firms || (Array.isArray(enrichRes.data) ? enrichRes.data : []);
            if (firms.length >= 1) {
                globalPaidCreditsSpent++;
                const firm = firms[0];
                console.log(`   [Nacional] ✅ Enriquecimento direto (state-level): "${firm.razao_social}" (${firm.cnpj})`);
                return {
                    cnpj: firm.cnpj,
                    razao_social: firm.razao_social,
                    nome_fantasia: firm.nome_fantasia,
                    cidade: firm.endereco?.cidade?.nome || city_name || 'N/A',
                    data_abertura: firm.data_abertura || null,
                    audit: {},
                    score: 1
                };
            }
        } catch (e) { /* skip */ }
    }

    return null;
}

const STATE_NAMES = {
    AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia',
    CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
    MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
    PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
    RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
    RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo',
    SE: 'Sergipe', TO: 'Tocantins'
};

async function runTextSearch(stateName, segment, limit = 0) {
    const url = "https://maps.googleapis.com/maps/api/place/textsearch/json";
    let allResults = [];
    let nextToken = null;
    let pageCount = 0;

    try {
        while (pageCount < 3) {
            if (limit > 0 && allResults.length >= limit) break;

            const params = { query: `${segment} no ${stateName}`, key: GOOGLE_API_KEY, language: "pt-BR" };
            if (nextToken) params.pagetoken = nextToken;

            const response = await axios.get(url, { params });
            const data = response.data;

            if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
                console.error(`  [TextSearch] Status: ${data.status}`, data.error_message || '');
                break;
            }

            if (data.results) {
                for (const place of data.results) {
                    if (limit > 0 && allResults.length >= limit) break;
                    if (shouldExclude(place.name, place.types || [])) continue;

                    const details = await getPlaceDetails(place.place_id);
                    allResults.push({
                        place_id: place.place_id,
                        nome: place.name || "N/A",
                        endereco: place.formatted_address || details.endereco_completo || "N/A",
                        telefone: details.telefone || 'N/A',
                        website: details.website || 'N/A',
                        instagram: extractInstagram(details.website),
                        types: place.types || []
                    });
                }
            }

            pageCount++;
            nextToken = data.next_page_token;
            if (!nextToken) break;
            await new Promise(r => setTimeout(r, 2000));
        }
    } catch (e) {
        console.error(`[TextSearch] Erro para ${stateName}:`, e.message);
    }

    return allResults;
}

app.post('/api/national/search', async (req, res) => {
    const { estados, segment, limit, skipList } = req.body;
    if (!estados || estados.length === 0 || !segment) {
        return res.status(400).json({ error: "Preencha Segmento e selecione ao menos um estado." });
    }

    const exclusions = (skipList || []).map(s => normalize(s));
    const numericLimit = limit ? parseInt(limit) : 0;

    try {
        // Fetch IBGE city lists for all selected states (same source as Busca Completa)
        const ibgeCidades = {};
        await Promise.all(estados.map(async uf => {
            try {
                const resp = await axios.get(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
                ibgeCidades[uf] = resp.data.map(m => m.nome);
            } catch (e) {
                ibgeCidades[uf] = [];
            }
        }));

        let googleResults = [];
        const seenPlaces = new Set();

        for (const uf of estados) {
            const stateName = STATE_NAMES[uf] || uf;
            console.log(`\n[Nacional] Buscando "${segment}" no ${stateName}...`);
            const results = await runTextSearch(stateName, segment, numericLimit);
            for (const r of results) {
                if (!seenPlaces.has(r.place_id)) {
                    seenPlaces.add(r.place_id);
                    googleResults.push({ ...r, uf });
                }
            }
            if (numericLimit > 0 && googleResults.length >= numericLimit) break;
        }

        if (exclusions.length > 0) {
            googleResults = googleResults.filter(p => {
                const nomeNorm = normalize(p.nome);
                return !exclusions.some(skip => nomeNorm.includes(skip) || skip.includes(nomeNorm));
            });
        }

        if (numericLimit > 0) googleResults = googleResults.slice(0, numericLimit);

        const finalResults = [];
        const seenCnpjs = new Set();

        for (const place of googleResults) {
            // Mirror Busca Completa: find city by matching IBGE names against the address
            const cidadesDoEstado = ibgeCidades[place.uf] || [];
            const cityFromPlace = cidadesDoEstado.find(c => normalize(place.endereco).includes(normalize(c)));

            let bizData = await runBizSearchNational(place.nome, place.endereco, segment, cityFromPlace, place.uf);
            if (bizData && seenCnpjs.has(bizData.cnpj)) bizData = null;
            if (bizData) seenCnpjs.add(bizData.cnpj);

            let deepData = { socios: [] };
            if (bizData) deepData = await runDeepSearchForCnpj(bizData.cnpj);

            finalResults.push({
                google: place,
                biz: bizData || { cnpj: 'Não encontrado', razao_social: 'N/A' },
                deep: deepData
            });
        }

        res.json(finalResults);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/reset-credits', (req, res) => {
    globalPaidCreditsSpent = 0;
    console.log("♻️ [ADMIN] Contador de créditos resetado manualmente.");
    res.json({ success: true, message: "Contador de créditos resetado para 0." });
});

// --- STATUS DAS APIS EXTERNAS ---
async function checkGoogleStatus() {
    try {
        const res = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
            params: { address: "São Paulo, SP, Brasil", key: GOOGLE_API_KEY, language: "pt-BR" }
        });
        if (res.data.status === "OK") {
            return { ok: true, message: "Conectado" };
        }
        return { ok: false, message: res.data.error_message || res.data.status };
    } catch (e) {
        return { ok: false, message: e.response?.data?.error_message || e.message };
    }
}

async function checkCnpjBizStatus() {
    try {
        await axios.post('https://cnpj.biz/api/v2/empresas/contar', {
            razao_fantasia: ["PETROBRAS"],
            situacao: ["ativa"]
        }, {
            headers: { 'Authorization': `Bearer ${CNPJ_BIZ_TOKEN}`, 'Content-Type': 'application/json' }
        });
        return { ok: true, message: "Conectado", lastPaidError: cnpjBizLastPaidError };
    } catch (e) {
        return { ok: false, message: e.response?.data?.message || e.message, lastPaidError: cnpjBizLastPaidError };
    }
}

async function checkBigDataCorpStatus() {
    try {
        const res = await axios.post("https://plataforma.bigdatacorp.com.br/empresas", {
            "Datasets": "basic_data",
            "q": "doc{33000167000101}" // Petrobras, usado só para testar conectividade
        }, { headers: BDC_HEADERS });
        if (res.data.Result) return { ok: true, message: "Conectado" };
        return { ok: false, message: "Resposta inesperada da API" };
    } catch (e) {
        return { ok: false, message: e.response?.data?.Message || e.response?.data?.message || e.message };
    }
}

app.get('/api/status', async (req, res) => {
    const [google, cnpjBiz, bigDataCorp] = await Promise.all([
        checkGoogleStatus(),
        checkCnpjBizStatus(),
        checkBigDataCorpStatus()
    ]);
    res.json({ checkedAt: new Date().toISOString(), google, cnpjBiz, bigDataCorp });
});

app.listen(PORT, () => console.log(`Servidor de Inteligência Híbrida em http://localhost:${PORT}`));