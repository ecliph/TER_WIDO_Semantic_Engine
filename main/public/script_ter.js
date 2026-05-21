// Dictionnaire des relations chargé en mémoire pour l'autocomplétion
let JDM_RELATIONS_DICT = null;

async function loadRelations() {
    if (JDM_RELATIONS_DICT) return JDM_RELATIONS_DICT;
    try {
        const response = await fetch('relations_wido_optimized.json');
        const data = await response.json();
        JDM_RELATIONS_DICT = {};
        for (const relation of data.relations) {
            JDM_RELATIONS_DICT[relation.name] = relation;
        }
        return JDM_RELATIONS_DICT;
    } catch (error) {
        console.error('Erreur chargement dictionnaire relations :', error);
    }
}

// Chargement anticipé du dictionnaire (non bloquant)
loadRelations();

// ─────────────────────────────────────────────────────────────────────────────
// Fonction principale de recherche
// ─────────────────────────────────────────────────────────────────────────────

async function lancerRecherche() {
    const q = document.getElementById('query').value;
    const resDiv = document.getElementById('resultat');
    const astDiv = document.getElementById('ast-viewer');

    if (!q.trim()) return;

    resDiv.innerHTML = '⏳ Recherche en cours...';
    astDiv.innerHTML = 'Analyse de la requête...';

    // Timeout frontend aligné sur le backend (130s > 120s backend)
    const FRONTEND_TIMEOUT_MS = 130000;
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), FRONTEND_TIMEOUT_MS);

    // Message progressif après 10s pour informer l'utilisateur
    const slowTimer = setTimeout(() => {
        if (resDiv.innerHTML.includes('⏳')) {
            resDiv.innerHTML += '<br><span style="font-size:0.88em;color:#94a3b8">⏳ Requête longue en cours... L\'API JeuxDeMots explore de nombreux candidats.</span>';
        }
    }, 10000);

    try {
        const response = await fetch(`http://localhost:3000/recherche?q=${encodeURIComponent(q)}`, {
            signal: controller.signal
        });
        clearTimeout(abortTimer);
        clearTimeout(slowTimer);

        const data = await response.json();

        // ── Affichage de l'AST ──────────────────────────────────────────────
        if (data.arbre) {
            astDiv.innerHTML = JSON.stringify(data.arbre, null, 2);
        } else {
            // Erreur de syntaxe : l'AST n'est pas disponible
            astDiv.innerHTML = '<span style="color:#f87171">AST non disponible — erreur de syntaxe dans la requête.</span>';
        }

        // ── CAS ERREUR : afficher une bannière d'erreur claire ──────────────
        if (data.statut === 'Erreur') {
            resDiv.innerHTML = `
                <div style="padding:14px 18px; border-radius:10px; background:rgba(239,68,68,0.12); border-left:4px solid #ef4444">
                    <b style="color:#ef4444">❌ Erreur</b><br>
                    <span style="color:#fca5a5">${escapeHtml(data.message || 'Erreur inconnue')}</span>
                    ${data.warnings && data.warnings.length > 0
                        ? `<div style="margin-top:8px; font-size:0.82em; color:#f87171">
                            ${data.warnings.map(w => `⚠️ ${escapeHtml(w)}`).join('<br>')}
                          </div>`
                        : ''}
                </div>`;
            return;
        }

        // ── CAS SUCCÈS (total ou partiel) ───────────────────────────────────
        const isPartial = data.statut === 'Succès partiel';
        const statusColor = isPartial ? '#f59e0b' : '#22c55e';
        const nbTotal = typeof data.nb_total === 'number' ? data.nb_total : 0;

        let headerHtml = `<div style="margin-bottom:12px; padding:10px 14px; border-radius:8px;
            background:${statusColor}18; border-left:4px solid ${statusColor}">
            <b>Statut :</b> ${escapeHtml(data.statut)} &nbsp;|&nbsp; <b>Résultats :</b> ${nbTotal}`;

        // Affichage des warnings (max 3 visibles)
        if (data.warnings && data.warnings.length > 0) {
            const infoWarnings = data.warnings.filter(w => w.includes('Affichage limité') || w.includes('Pagination API'));
            const realWarnings = data.warnings.filter(w => !w.includes('Affichage limité') && !w.includes('Pagination API'));

            if (infoWarnings.length > 0) {
                headerHtml += `<div style="font-size:0.8em; color:#94a3b8; margin-top:4px">ℹ️ ${escapeHtml(infoWarnings[0])}</div>`;
            }
            if (realWarnings.length > 0) {
                const MAX_VISIBLE = 3;
                headerHtml += '<div style="margin-top:6px">';
                realWarnings.slice(0, MAX_VISIBLE).forEach(w => {
                    headerHtml += `<div style="font-size:0.82em; color:#f59e0b">⚠️ ${escapeHtml(w)}</div>`;
                });
                if (realWarnings.length > MAX_VISIBLE) {
                    headerHtml += `<div style="font-size:0.78em;color:#64748b">+ ${realWarnings.length - MAX_VISIBLE} autre(s) warning(s) — voir console</div>`;
                    console.warn('Tous les warnings WIDO :', data.warnings);
                }
                headerHtml += '</div>';
            }
        }

        // Stats de pagination
        let paginationHtml = '';
        if (data.debug && data.debug.paginationStats && data.debug.paginationStats.length > 0) {
            const pages = data.debug.paginationStats;
            const usedPagination = pages.some(p => p.usedPagination);
            if (usedPagination) {
                const totalPages = pages.reduce((s, p) => s + (p.pagesFetched || 0), 0);
                const totalFetched = pages.reduce((s, p) => s + (p.totalFetched || 0), 0);
                const limitReached = pages.some(p => p.reachedPaginationLimit) ? 'oui' : 'non';
                paginationHtml = `
                    <div style="margin-top:12px; font-size:0.85em; color:#475569;">
                        <b>📄 API / Pagination</b><br>
                        Pages récupérées : ${totalPages}<br>
                        Relations récupérées : ${totalFetched}<br>
                        Limite pagination atteinte : ${limitReached}
                    </div>`;
            }
        }

        // Stats de jointure
        let joinHtml = '';
        if (data.debug && data.debug.joinStats) {
            const j = data.debug.joinStats;
            joinHtml = `
                <div style="margin-top:12px; font-size:0.85em; color:#475569;">
                    <b>📊 Jointure</b><br>
                    Relation : ${escapeHtml(j.relation || '?')}<br>
                    Variable ancrée : ${escapeHtml(j.anchorVariable || '?')}<br>
                    Variable découverte : ${escapeHtml(j.discoveredVariable || '?')}<br>
                    Candidats testés : ${j.candidatsTestes} / ${j.candidatsDisponibles}<br>
                    Couples trouvés : ${j.couplesTrouves}<br>
                    Exploration limitée : ${j.wasLimited ? 'oui' : 'non'}<br>
                    Comparaison par ID : ${j.usedIdComparison ? 'oui' : 'non'}
                </div>`;
        }

        // Plan d'exécution
        let planHtml = '';
        if (data.plan_details && data.plan_details.length > 0) {
            planHtml = `
                <div style="margin-top:12px; font-size:0.85em; color:#475569;">
                    <b>🗺️ Plan d'exécution</b><br>
                    <table style="width:100%; text-align:left; border-collapse:collapse; margin-top:4px;">
                        <tr style="border-bottom:1px solid #cbd5e1;">
                            <th style="padding:2px;">Rang</th>
                            <th style="padding:2px;">Clause</th>
                            <th style="padding:2px;">Complexité</th>
                            <th style="padding:2px;">Cardinalité estimée</th>
                            <th style="padding:2px;">Raison</th>
                        </tr>`;
            data.plan_details.slice(0, 5).forEach(step => {
                planHtml += `
                        <tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:2px;">${step.rang}</td>
                            <td style="padding:2px; font-family:monospace;">${escapeHtml(step.clause)}</td>
                            <td style="padding:2px;">${step.structuralComplexity}</td>
                            <td style="padding:2px;">${step.estimatedCardinality !== undefined && step.estimatedCardinality !== null ? step.estimatedCardinality : '?'}</td>
                            <td style="padding:2px;">${escapeHtml(step.reason)}</td>
                        </tr>`;
            });
            planHtml += `</table>`;
            if (data.plan_details.length > 5) {
                planHtml += `<div style="font-size:0.8em; color:#94a3b8; margin-top:2px;">+ ${data.plan_details.length - 5} autres étapes (voir console)</div>`;
            }
            planHtml += `</div>`;
        }

        // Performance
        let perfHtml = '';
        if (data.debug && data.debug.timings) {
            const t = data.debug.timings;
            const c = data.debug.cacheStats;
            const cacheStr = c ? `Cache : ${c.hits} hits / ${c.misses} misses` : 'Cache : non disponible';
            perfHtml = `
                <div style="margin-top:12px; font-size:0.85em; color:#475569;">
                    <b>📈 Performance</b><br>
                    Temps total serveur : ${data.debug.durationMs} ms<br>
                    Parsing : ${t.parseMs} ms<br>
                    Cardinalité / heuristique : ${t.cardinalityMs} ms<br>
                    Planification : ${t.planningMs} ms<br>
                    Exécution moteur : ${t.executionMs} ms<br>
                    Construction réponse : ${t.responseBuildMs} ms<br>
                    Appels API : ${data.debug.apiCalls !== undefined ? data.debug.apiCalls : 'non disponible'}<br>
                    Erreurs API : ${data.debug.apiErrors !== undefined ? data.debug.apiErrors : 'non disponible'}<br>
                    ${cacheStr}
                </div>`;
        }

        headerHtml += perfHtml + paginationHtml + joinHtml + planHtml;
        headerHtml += '</div>';

        // ── Affichage des résultats ─────────────────────────────────────────
        if (data.resultats && data.resultats.length > 0) {
            const lignes = data.resultats.map((r, index) => {
                const variables = Object.keys(r).filter(k => !k.startsWith('__'));
                const varHtml = variables.map(v => {
                    const val = r[v] && r[v].name ? escapeHtml(r[v].name) : '?';
                    return `<span style="margin-right:16px"><b>${escapeHtml(v)}</b> : ${val}</span>`;
                }).join('');

                const score = r.__score !== undefined && r.__score !== null
                    ? Number(r.__score).toFixed(2)
                    : null;
                const scoreHtml = score !== null
                    ? `<span style="font-size:0.8em; color:#94a3b8; margin-left:8px">Score : ${score}</span>`
                    : '';

                let preuvesHtml = '';
                if (r.__preuves && r.__preuves.length > 0) {
                    const pid = `p${index}`;
                    preuvesHtml = `
                        <span style="font-size:0.75em; cursor:pointer; color:#64748b; margin-left:8px"
                              onclick="document.getElementById('${pid}').style.display=
                                       document.getElementById('${pid}').style.display==='none'?'block':'none'"
                        >[preuves]</span>
                        <div id="${pid}" style="display:none; font-size:0.75em; color:#475569; margin-top:4px">
                            ${r.__preuves.map(p => `${escapeHtml(p.clause)} (w=${p.w})`).join(' | ')}
                        </div>`;
                }

                return `<li style="animation-delay:${index * 0.04}s">${varHtml}${scoreHtml}${preuvesHtml}</li>`;
            });
            resDiv.innerHTML = headerHtml + `<ul>${lignes.join('')}</ul>`;
        } else {
            // Aucun résultat — message clair selon le contexte
            let noResultMsg = 'Aucun résultat trouvé pour cette requête.';
            if (data.debug && data.debug.joinStats && data.debug.joinStats.couplesTrouves === 0) {
                noResultMsg = `Aucun couple valide trouvé dans la portion explorée (${data.debug.joinStats.candidatsTestes} candidats testés).`;
            }
            resDiv.innerHTML = headerHtml + `<div class="code-block">${noResultMsg}</div>`;
        }

    } catch (err) {
        clearTimeout(abortTimer);
        clearTimeout(slowTimer);
        astDiv.innerHTML = '';

        if (err.name === 'AbortError') {
            resDiv.innerHTML = `
                <div style="padding:14px 18px; border-radius:10px;
                    background:rgba(127,29,29,0.2); border-left:4px solid #ef4444">
                    <b>⚠️ Requête trop longue ou API JDM lente.</b><br>
                    La recherche a été arrêtée après ${FRONTEND_TIMEOUT_MS / 1000}s pour éviter un blocage.<br>
                    <span style="font-size:0.85em;color:#94a3b8">
                        Conseil : essayez une requête plus restrictive,
                        par exemple <code>($x r_isa animal) ET ($x = ch%)</code>
                    </span>
                </div>`;
        } else {
            resDiv.innerHTML = '❌ Erreur de connexion. Le serveur est-il bien lancé sur le port 3000 ?';
            console.error('Erreur WIDO :', err);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────────────────────────────────

/** Échappe les caractères HTML pour éviter les injections XSS */
function escapeHtml(str) {
    if (typeof str !== 'string') return String(str);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Touche Entrée pour lancer la recherche
document.getElementById('query').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') lancerRecherche();
});