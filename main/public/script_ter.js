// Variable globale contenant le dictionnaire mis en cache pour ne pas faire de multiples requetes
let JDM_RELATIONS_DICT = null

// Cette fonction charge le fichier JSON une seule fois au demarrage
async function loadRelations() {
    // Si on a deja les relations en memoire on les recupere direct
    if (JDM_RELATIONS_DICT) return JDM_RELATIONS_DICT
    
    try {
        // Demande au navigateur de lire notre fichier de dictionnaire optimise
        let response = await fetch('relations_wido_optimized.json')
        let data = await response.json()
        
        // On le definit sous forme d objet dictionnaire Map pour acces instantane en O 1 au lieu de O n sur tableau list
        JDM_RELATIONS_DICT = {}
        for (let relation of data.relations) {
            JDM_RELATIONS_DICT[relation.name] = relation
        }
        
        console.log("Dictionnaire des relations charge avec succes en cache")
        return JDM_RELATIONS_DICT
    } catch (error) {
        console.error("Erreur lors du chargement de notre dictionnaire", error)
    }
}

// Fonction magique pour traduire un nom ecrit par l humain en ID mathematique
function getRelationInfoByName(nomRelation) {
    if (!JDM_RELATIONS_DICT) return null
    // Acces instantane en complexite O 1 sans jamais parcourir de longue liste
    return JDM_RELATIONS_DICT[nomRelation]
}

// Le but ici est de fouiller l arbre pour recuperer toutes les pieces logiques une par une
function extraireClauses(arbre) {
    let clauses = []
    if (!arbre) return clauses
    
    // Si c est une brique de base on la garde
    if (arbre.type === 'CLAUSE_RELATION') {
        clauses.push(arbre)
    } 
    // Sinon si c est un croisement avec ET ou OU on creuse a gauche et a droite
    else if (arbre.type === 'NOEUD_LOGIQUE') {
        clauses = clauses.concat(extraireClauses(arbre.gauche))
        clauses = clauses.concat(extraireClauses(arbre.droite))
    }
    return clauses
}

// L Heuristique Etape 3 ou on choisit l ordre d execution le plus logique
function trierClausesParContrainte(clauses) {
    // On trie grace a la methode sort
    return clauses.sort((a, b) => {
        let infoA = getRelationInfoByName(a.relation)
        let infoB = getRelationInfoByName(b.relation)
        
        // On lit les fameux scores q constraint
        let scoreA = infoA && infoA.q_constraint ? infoA.q_constraint.score : 0
        let scoreB = infoB && infoB.q_constraint ? infoB.q_constraint.score : 0
        
        // Plus le score est gros plus la clause remonte en priorite absolue
        return scoreB - scoreA
    })
}

// Plus besoin de document.getElementById('btn') car index_ter.html appelle directement lancerRecherche()
async function lancerRecherche() {
    const q = document.getElementById('query').value;
    const resDiv = document.getElementById('resultat');
    const astDiv = document.getElementById('ast-viewer');

    if (!q.trim()) return;

    resDiv.innerHTML = "Recherche en cours... ⏳";
    astDiv.innerHTML = "Fabrication de l'arbre...";

    // Timeout frontend : 130 secondes maximum (aligné sur le timeout backend 120s)
    const FRONTEND_TIMEOUT_MS = 130000;
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), FRONTEND_TIMEOUT_MS);

    // Message progressif après 10s
    const slowTimer = setTimeout(() => {
        if (resDiv.innerHTML.includes('⏳')) {
            resDiv.innerHTML += '<br><span style="font-size:0.88em;color:#94a3b8">⏳ Cette requête peut être longue car elle explore beaucoup de candidats dans JeuxDeMots...</span>';
        }
    }, 10000);

    try {
        const response = await fetch(`http://localhost:3000/recherche?q=${encodeURIComponent(q)}`, {
            signal: controller.signal
        });
        clearTimeout(abortTimer);
        clearTimeout(slowTimer);
        const data = await response.json();

        // 1. Affichage de l'arbre AST
        astDiv.innerHTML = JSON.stringify(data.arbre, null, 2);

        // 2. En-tête : statut + warnings
        const isPartial = data.statut === 'Succès partiel';
        const statusColor = isPartial ? '#f59e0b' : '#22c55e';
        let headerHtml = `<div style="margin-bottom:12px; padding:8px 12px; border-radius:8px; background:${statusColor}22; border-left:4px solid ${statusColor}">`;
        headerHtml += `<b>Statut :</b> ${data.statut || 'Inconnu'} &nbsp;|&nbsp; <b>Résultats :</b> ${data.nb_total}`;

        if (data.warnings && data.warnings.length > 0) {
            const MAX_VISIBLE = 3;
            // Séparer les infos (limité) et les vraies erreurs
            const infoWarnings = data.warnings.filter(w => w.includes('Affichage limit'));
            const realWarnings = data.warnings.filter(w => !w.includes('Affichage limit'));

            // Afficher les infos en bleu (non bloquant)
            if (infoWarnings.length > 0) {
                headerHtml += `<div style="font-size:0.8em; color:#94a3b8; margin-top:4px">ℹ️ ${infoWarnings[0]}</div>`;
            }
            // Afficher les vrais warnings (max 3)
            if (realWarnings.length > 0) {
                headerHtml += '<div style="margin-top:6px">';
                const visible = realWarnings.slice(0, MAX_VISIBLE);
                visible.forEach(w => {
                    headerHtml += `<div style="font-size:0.82em; color:#f59e0b">⚠️ ${w}</div>`;
                });
                if (realWarnings.length > MAX_VISIBLE) {
                    headerHtml += `<div style="font-size:0.78em; color:#64748b">+ ${realWarnings.length - MAX_VISIBLE} autre(s) warning(s) (voir console)</div>`;
                    console.warn('Tous les warnings:', data.warnings);
                }
                headerHtml += '</div>';
            }
        }
        headerHtml += '</div>';


        // 3. Affichage des tuples de résultats
        if (data.resultats && data.resultats.length > 0) {
            const lignes = data.resultats.map((r, index) => {
                // Variables réelles uniquement (celles qui ne commencent pas par __)
                const variables = Object.keys(r).filter(k => !k.startsWith('__'));
                const varHtml = variables.map(v => {
                    const val = r[v] && r[v].name ? r[v].name : '?';
                    return `<span style="margin-right:16px"><b>${v}</b> : ${val}</span>`;
                }).join('');

                // Score
                const score = r.__score !== undefined && r.__score !== null
                    ? Number(r.__score).toFixed(2)
                    : null;
                const scoreHtml = score !== null
                    ? `<span style="font-size:0.8em; color:#94a3b8; margin-left:8px">Score : ${score}</span>`
                    : '';

                // Preuves (masquées par défaut, bouton toggle)
                let preuvesHtml = '';
                if (r.__preuves && r.__preuves.length > 0) {
                    const pid = `p${index}`;
                    preuvesHtml = `
                        <span style="font-size:0.75em; cursor:pointer; color:#64748b; margin-left:8px" onclick="document.getElementById('${pid}').style.display=document.getElementById('${pid}').style.display==='none'?'block':'none'">[preuves]</span>
                        <div id="${pid}" style="display:none; font-size:0.75em; color:#475569; margin-top:4px">${r.__preuves.map(p => `${p.clause} (w=${p.w})`).join(' | ')}</div>
                    `;
                }

                return `<li style="animation-delay:${index * 0.04}s">${varHtml}${scoreHtml}${preuvesHtml}</li>`;
            });
            resDiv.innerHTML = headerHtml + `<ul>${lignes.join('')}</ul>`;
        } else {
            resDiv.innerHTML = headerHtml + "<div class='code-block'>Aucun résultat trouvé pour cette requête.</div>";
        }
    } catch (err) {
        clearTimeout(abortTimer);
        clearTimeout(slowTimer);
        astDiv.innerHTML = '';
        if (err.name === 'AbortError') {
            resDiv.innerHTML = `
                <div style="padding:12px; border-radius:8px; background:#7f1d1d22; border-left:4px solid #ef4444">
                    <b>⚠️ Requête trop longue ou API JDM lente.</b><br>
                    La recherche a été arrêtée après ${FRONTEND_TIMEOUT_MS/1000}s pour éviter un blocage.<br>
                    <span style="font-size:0.85em;color:#94a3b8">Conseil : essayez une requête plus restrictive, par exemple <code>($x r_isa animal) ET ($x = ch%)</code></span>
                </div>`;
        } else {
            resDiv.innerHTML = "❌ Erreur de connexion au serveur. Est-il bien lancé sur le port 3000 ?";
            console.error(err);
        }
    }
}

// Ajout magique pour que la touche "Entrée" fonctionne automatiquement !
document.getElementById('query').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        lancerRecherche();
    }
});