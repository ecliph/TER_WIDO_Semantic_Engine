/**
 * Benchmark automatique du moteur WIDO.
 *
 * Lance une série de requêtes sur le serveur en cours d'exécution (localhost:3000)
 * et génère deux fichiers de résultats :
 *   - benchmark_results.json : données brutes
 *   - benchmark_results.md   : tableau lisible pour le rapport LaTeX
 *
 * Lancement :
 *   node main/node.js        (dans un terminal)
 *   node main/benchmark.js   (dans un autre terminal)
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const BASE_URL = 'http://localhost:3000/recherche';
const TIMEOUT_MS = 140000; // 140s par requête pour les jointures lourdes

// ─────────────────────────────────────────────────────────────────────────────
// Requêtes de test
// ─────────────────────────────────────────────────────────────────────────────
const REQUETES = [
    { id: 1,  q: '($x r_isa animal)',                                                                desc: 'Requête simple — variable à droite' },
    { id: 2,  q: '($x r_isa animal) ET ($x = ch%)',                                                  desc: 'Filtre texte ch%' },
    { id: 3,  q: '($x r_isa animal) ET ($x r_has_part queue)',                                       desc: 'Jointure ET avec propriété' },
    { id: 4,  q: '(($x r_isa mammifere) OU ($x r_isa oiseau)) ET ($x = ch%)',                        desc: 'OU imbriqué + filtre' },
    { id: 5,  q: '($x r_isa artiste) ET (($x = ba%) OU ($x = Ba%))',                                desc: 'Requête officielle artiste' },
    { id: 6,  q: '($x r_isa animal) ET (($x r_has_part aile) OU ($x r_has_part queue))',             desc: 'ET avec OU dans propriété' },
    { id: 7,  q: '($x r_isa animal) ET ($y r_isa animal) ET ($x r_can_eat $y)',                      desc: 'Requête 2 variables — officielle TER', timeout: TIMEOUT_MS },
    { id: 8,  q: '(chat r_isa $x)',                                                                   desc: 'Direction inverse — constante à gauche' },
    { id: 9,  q: '(chat r_has_part $x)',                                                              desc: 'Exploration propriétés du chat' },
    { id: 10, q: '(chat r_has_part $y) ET ($y r_isa $z)',                                             desc: '3 variables — chaîne de relations', timeout: TIMEOUT_MS },
    { id: 11, q: '($x r_isa animal) ET ($x r_has_part $y) ET ($y = pa%)',                            desc: '3 variables avec filtre' },
    { id: 12, q: '(lion r_can_eat $y) ET ($y r_isa animal)',                                          desc: 'Requête ciblée — proies du lion' },
    { id: 13, q: '($x r_isa)',                                                                        desc: 'Erreur syntaxique attendue',  expectError: true },
    { id: 14, q: '($x relation_inconnue animal)',                                                     desc: 'Relation inconnue attendue',  expectError: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// Exécution d'une requête et extraction des métriques
// ─────────────────────────────────────────────────────────────────────────────
async function benchmarkRequete(item) {
    const start = Date.now();
    let result = {
        id: item.id,
        query: item.q,
        description: item.desc,
        statut: 'N/A',
        nb_total: 0,
        durationMs: 0,
        apiCalls: 0,
        apiErrors: 0,
        cacheHits: 0,
        cacheMisses: 0,
        pagesFetched: 0,
        totalFetched: 0,
        usedPagination: false,
        warnings: [],
        joinStats: null,
        planDetails: null,
        success: false,
        errorMessage: null
    };

    try {
        const response = await axios.get(BASE_URL, {
            params: { q: item.q },
            timeout: item.timeout || 35000
        });
        const data = response.data;
        const duration = Date.now() - start;

        result.statut = data.statut || 'N/A';
        result.nb_total = typeof data.nb_total === 'number' ? data.nb_total : 0;
        result.durationMs = duration;
        result.warnings = data.warnings || [];
        result.success = item.expectError
            ? (data.statut === 'Erreur')
            : (data.statut === 'Succès' || data.statut === 'Succès partiel');

        if (data.debug) {
            result.apiCalls = data.debug.apiCalls || 0;
            result.apiErrors = data.debug.apiErrors || 0;
            if (data.debug.cacheStats) {
                result.cacheHits = data.debug.cacheStats.hits || 0;
                result.cacheMisses = data.debug.cacheStats.misses || 0;
            }
            if (data.debug.paginationStats && data.debug.paginationStats.length > 0) {
                result.pagesFetched = data.debug.paginationStats.reduce((s, p) => s + (p.pagesFetched || 0), 0);
                result.totalFetched = data.debug.paginationStats.reduce((s, p) => s + (p.totalFetched || 0), 0);
                result.usedPagination = data.debug.paginationStats.some(p => p.usedPagination);
            }
            result.joinStats = data.debug.joinStats || null;
        }
        result.planDetails = data.plan_details || null;

    } catch (err) {
        const duration = Date.now() - start;
        result.durationMs = duration;
        if (err.response) {
            result.statut = `HTTP ${err.response.status}`;
            result.errorMessage = err.response.data && err.response.data.message
                ? err.response.data.message
                : `HTTP ${err.response.status}`;
            // Erreurs syntaxiques sont maintenant retournées comme JSON propre
            // Si on arrive ici avec un 4xx/5xx, c'est une vraie erreur serveur
            result.success = false;
        } else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
            result.statut = 'TIMEOUT';
            result.errorMessage = `Timeout client (${(item.timeout || 35000) / 1000}s)`;
            result.success = false;
        } else if (err.code === 'ECONNREFUSED') {
            result.statut = 'SERVEUR_ÉTEINT';
            result.errorMessage = 'Connexion refusée — le serveur n\'est pas lancé.';
            result.success = false;
        } else {
            result.statut = 'ERREUR';
            result.errorMessage = err.message;
            result.success = false;
        }
    }

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Génération du rapport Markdown
// ─────────────────────────────────────────────────────────────────────────────
function genererMarkdown(resultats) {
    const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
    let md = `# Benchmark WIDO — Résultats\n\n`;
    md += `_Généré le ${date}_\n\n`;
    md += `## Tableau récapitulatif\n\n`;
    md += `| # | Requête | Statut | Résultats | Temps (ms) | Appels API | Pagination | Remarque |\n`;
    md += `|---|---------|--------|----------:|----------:|----------:|-----------|----------|\n`;

    for (const r of resultats) {
        const statut = r.statut;
        const queryShort = r.query.length > 50 ? r.query.slice(0, 47) + '...' : r.query;
        const pagStr = r.usedPagination ? `${r.pagesFetched}p/${r.totalFetched}` : 'Non';
        const remarque = r.errorMessage
            ? r.errorMessage.slice(0, 60)
            : (r.joinStats
                ? `Join: ${r.joinStats.couplesTrouves} couples, ${r.joinStats.candidatsTestes} testés`
                : (r.warnings.length > 0 ? r.warnings[0].slice(0, 50) : '-'));

        md += `| ${r.id} | \`${queryShort}\` | ${statut} | ${r.nb_total} | ${r.durationMs} | ${r.apiCalls} | ${pagStr} | ${remarque} |\n`;
    }

    // Section détaillée des jointures
    const avecJoin = resultats.filter(r => r.joinStats);
    if (avecJoin.length > 0) {
        md += `\n## Détail des jointures à deux variables\n\n`;
        for (const r of avecJoin) {
            const j = r.joinStats;
            md += `### Requête #${r.id} : \`${r.query}\`\n\n`;
            md += `- **Relation** : ${j.relation || '?'}\n`;
            md += `- **Variable ancrée** : ${j.anchorVariable || '?'}\n`;
            md += `- **Variable découverte** : ${j.discoveredVariable || '?'}\n`;
            md += `- **Candidats disponibles** : ${j.candidatsDisponibles}\n`;
            md += `- **Candidats testés** : ${j.candidatsTestes}\n`;
            md += `- **Couples trouvés** : ${j.couplesTrouves}\n`;
            md += `- **Exploration limitée** : ${j.wasLimited ? 'Oui' : 'Non'}\n`;
            md += `- **Arrêt anticipé** : ${j.reachedEarlyStop ? 'Oui' : 'Non'}\n`;
            md += `- **Comparaison par ID** : ${j.usedIdComparison ? 'Oui' : 'Non'}\n\n`;
        }
    }

    // Section plan d'exécution pour requêtes complexes
    const avecPlan = resultats.filter(r => r.planDetails && r.planDetails.length > 1);
    if (avecPlan.length > 0) {
        md += `\n## Exemples de plans d'exécution (heuristiques)\n\n`;
        for (const r of avecPlan.slice(0, 3)) {
            md += `### Requête #${r.id} : \`${r.query}\`\n\n`;
            md += `| Rang | Clause | Complexité | Cardinalité | Raison |\n`;
            md += `|-----:|--------|----------:|------------:|--------|\n`;
            for (const step of r.planDetails) {
                md += `| ${step.rang} | \`${step.clause}\` | ${step.structuralComplexity} | ${step.estimatedCardinality || '?'} | ${step.reason} |\n`;
            }
            md += '\n';
        }
    }

    md += `\n## Résumé\n\n`;
    const success = resultats.filter(r => r.success).length;
    const total = resultats.length;
    const avgDuration = Math.round(resultats.reduce((s, r) => s + r.durationMs, 0) / total);
    const totalApiCalls = resultats.reduce((s, r) => s + r.apiCalls, 0);

    md += `- **Requêtes réussies** : ${success}/${total}\n`;
    md += `- **Durée moyenne** : ${avgDuration} ms\n`;
    md += `- **Appels API totaux** : ${totalApiCalls}\n`;
    md += `- **Pagination utilisée** : ${resultats.filter(r => r.usedPagination).length} requête(s)\n`;
    md += `\n_Note : Les requêtes à deux variables (7, 10) peuvent retourner 0 résultats selon la disponibilité de la relation dans JDM._\n`;

    return md;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    console.log('='.repeat(60));
    console.log('🔬 WIDO Benchmark — Version Finale TER');
    console.log('='.repeat(60));
    console.log(`📡 Serveur cible : ${BASE_URL}`);
    console.log(`📋 Requêtes à tester : ${REQUETES.length}`);
    console.log('');

    const resultats = [];

    for (const item of REQUETES) {
        process.stdout.write(`[${item.id.toString().padStart(2, '0')}/${REQUETES.length}] ${item.desc.padEnd(50)} → `);
        const result = await benchmarkRequete(item);
        resultats.push(result);

        const statusStr = result.success
            ? `✅ ${result.statut} (${result.nb_total} résultats, ${result.durationMs}ms)`
            : `❌ ${result.statut} — ${(result.errorMessage || '').slice(0, 60)}`;
        console.log(statusStr);

        if (result.joinStats) {
            const j = result.joinStats;
            console.log(`       📊 Join: ${j.couplesTrouves} couples / ${j.candidatsTestes} testés`);
        }
    }

    console.log('\n' + '='.repeat(60));
    const success = resultats.filter(r => r.success).length;
    console.log(`📊 Résultat : ${success}/${resultats.length} requêtes réussies`);
    console.log('='.repeat(60));

    // Sauvegarde des fichiers
    const outDir = path.join(__dirname);
    await fs.writeJson(path.join(outDir, 'benchmark_results.json'), resultats, { spaces: 2 });
    const md = genererMarkdown(resultats);
    await fs.writeFile(path.join(outDir, 'benchmark_results.md'), md, 'utf-8');

    console.log('\n✅ Fichiers générés :');
    console.log('   - main/benchmark_results.json');
    console.log('   - main/benchmark_results.md');
}

main().catch(err => {
    if (err.code === 'ECONNREFUSED') {
        console.error('\n❌ Connexion refusée — Assurez-vous que le serveur tourne :');
        console.error('   node main/node.js');
    } else {
        console.error('\n❌ Erreur benchmark :', err.message);
    }
    process.exit(1);
});
