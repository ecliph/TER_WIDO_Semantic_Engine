const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');

// Modules du moteur WIDO
const CacheManager = require('./cacheManager');
const JdmApi = require('./jdmApi');
const Heuristiques = require('./heuristiques');
const MoteurExecution = require('./moteurExecution');
const { creerArbreDeDecision } = require('./parseur.js');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index_ter.html')));

// ─────────────────────────────────────────────────────────────────────────────
// Configuration des limites globales
// ─────────────────────────────────────────────────────────────────────────────
const LIMITS = {
    maxInitialCandidates: 1000,   // Candidats max par clause simple
    maxJoinPairs: 10000,          // Paires max lors d'une jointure cartésienne
    joinCandidateLimit: 500,      // Candidats max testés dans une jointure var-var
    joinEarlyStop: 1000,          // Arrêt anticipé si trop de couples trouvés
    maxApiCallsPerQuery: 1000,    // Garde-fou global sur les appels API
    apiTimeoutMs: 15000,          // Timeout par appel API (15s)
    maxResultsReturned: 1000,     // Résultats max retournés à l'interface
    maxQueryDurationMs: 120000    // Timeout global de la requête (120s)
};

// Initialisation des couches
const cache = new CacheManager(path.join(__dirname, 'cache'));
const api = new JdmApi(cache, LIMITS);
const moteur = new MoteurExecution(api, LIMITS);

// ─────────────────────────────────────────────────────────────────────────────
// Route principale : exécution d'une requête WIDO
// ─────────────────────────────────────────────────────────────────────────────
app.get('/recherche', async (req, res) => {
    const q = req.query.q;
    const start = Date.now();

    if (!q || !q.trim()) {
        return res.json({
            statut: 'Erreur',
            message: 'Paramètre de requête manquant.',
            query: q || '',
            nb_total: 0,
            resultats: [],
            warnings: [],
            arbre: null,
            plan_execution: null,
            plan_details: null,
            debug: { durationMs: 0, apiCalls: 0, apiErrors: 0, timeoutReached: false }
        });
    }

    // Réinitialiser les compteurs à chaque nouvelle requête
    api.resetDebugInfo();

    let ast = null;
    let parseMs = 0, cardinalityMs = 0, planningMs = 0, executionMs = 0, responseBuildMs = 0;

    try {
        // ── Étape 1 : Parsing ───────────────────────────────────────────────
        const t0 = Date.now();
        try {
            ast = creerArbreDeDecision(q);
        } catch (parseErr) {
            // Erreur syntaxique → réponse propre (pas de HTTP 500 qui casse le frontend)
            return res.json({
                statut: 'Erreur',
                message: `Erreur de syntaxe : ${parseErr.message}`,
                query: q,
                nb_total: 0,
                resultats: [],
                warnings: [`Syntaxe invalide — la requête n'a pas pu être analysée.`],
                arbre: null,
                plan_execution: null,
                plan_details: null,
                debug: { durationMs: Date.now() - start, timings: { parseMs: Date.now() - t0, cardinalityMs: 0, planningMs: 0, executionMs: 0, responseBuildMs: 0 }, apiCalls: 0, apiErrors: 0, timeoutReached: false }
            });
        }
        parseMs = Date.now() - t0;

        // ── Étape 2 : Estimation de cardinalité (optionnelle, pour heuristiques) ─
        const t1 = Date.now();
        let cardinalityMap = null;
        try {
            cardinalityMap = await estimerCardinalites(ast, api, moteur);
        } catch (cardErr) {
            // Non bloquant : si ça échoue, on continue avec l'heuristique structurelle
            console.warn('⚠️ Estimation cardinalité échouée (fallback structurel) :', cardErr.message);
        }
        cardinalityMs = Date.now() - t1;

        // ── Étape 3 : Planning avec heuristiques ───────────────────────────
        const t2 = Date.now();
        const plan = Heuristiques.planifierExecution(ast, new Set(), cardinalityMap);
        const planDetails = plan._planDetails || null;
        planningMs = Date.now() - t2;

        // ── Étape 4 : Exécution avec timeout global ─────────────────────────
        const t3 = Date.now();
        const MAX_DURATION = LIMITS.maxQueryDurationMs;
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('__QUERY_TIMEOUT__')), MAX_DURATION)
        );

        let resultats;
        let timedOut = false;
        try {
            resultats = await Promise.race([moteur.executerPlan(plan), timeoutPromise]);
        } catch (timeoutErr) {
            if (timeoutErr.message === '__QUERY_TIMEOUT__') {
                timedOut = true;
                resultats = [];
                resultats._joinWarning = `Requête arrêtée après ${MAX_DURATION / 1000}s (délai maximum dépassé). Résultats partiels affichés.`;
            } else {
                throw timeoutErr;
            }
        }
        executionMs = Date.now() - t3;

        // ── Étape 5 : Construction de la réponse ─────────────────────────────
        const t4 = Date.now();
        const duration = Date.now() - start;
        const apiInfo = api.getDebugInfo(); // { apiCalls, errorCount, errors }

        // Warnings : dédupliqués, limités à l'essentiel
        const warnings = [];
        if (apiInfo.errorCount > 0) {
            warnings.push(`L'API JeuxDeMots n'a pas répondu correctement pour ${apiInfo.errorCount} appel(s). Les résultats affichés sont partiels.`);
        }
        if (resultats._joinWarning) warnings.push(resultats._joinWarning);

        const cleanResultats = Array.isArray(resultats) ? resultats : [];
        const resultLimitDebug = cleanResultats._resultLimitDebug || { wasDisplayLimited: false };
        if (resultLimitDebug.wasDisplayLimited) {
            warnings.push(`Affichage limité aux ${resultLimitDebug.maxResultsReturned} meilleurs résultats (triés par score).`);
        }

        const joinStats = resultats._joinDebug || null;
        if (joinStats && joinStats.wasLimited) {
            warnings.push(`Exploration de jointure bornée : ${joinStats.candidatsTestes} candidats testés sur ${joinStats.candidatsDisponibles} disponibles.`);
        }
        const paginationStats = resultats._paginationStats && resultats._paginationStats.length > 0
            ? resultats._paginationStats
            : null;

        // Pages de pagination utilisées ?
        if (paginationStats) {
            const usedPagination = paginationStats.some(p => p.usedPagination);
            const totalFetched = paginationStats.reduce((s, p) => s + (p.totalFetched || 0), 0);
            if (usedPagination) {
                // warnings.push(`Pagination API utilisée : ${totalFetched} relations récupérées au total.`);
            }
            const reachedLimit = paginationStats.some(p => p.reachedPaginationLimit);
            if (reachedLimit) {
                warnings.push(`Récupération API bornée : la pagination a atteint la limite de sécurité. Des relations supplémentaires peuvent exister dans JeuxDeMots.`);
            }
        }

        const hasErrors = apiInfo.errorCount > 0 || timedOut;
        
        responseBuildMs = Date.now() - t4;

        res.json({
            statut: hasErrors ? 'Succès partiel' : 'Succès',
            query: q,
            nb_total: cleanResultats.length,
            resultats: cleanResultats,
            warnings,
            arbre: ast,
            plan_execution: plan,
            plan_details: planDetails,
            debug: {
                durationMs: duration,
                timings: {
                    parseMs,
                    cardinalityMs,
                    planningMs,
                    executionMs,
                    responseBuildMs
                },
                apiCalls: apiInfo.apiCalls,       // ← champ correct (corrigé)
                apiErrors: apiInfo.errorCount,    // ← champ correct (corrigé)
                timeoutReached: timedOut,
                cacheStats: cache.getReport(),
                paginationStats,
                joinStats,
                resultLimitDebug
            }
        });

    } catch (err) {
        // Erreur inattendue du moteur (pas syntaxique)
        console.error('❌ Erreur moteur :', err.message);
        res.json({
            statut: 'Erreur',
            message: err.message,
            query: q,
            nb_total: 0,
            resultats: [],
            warnings: [`Erreur interne du moteur : ${err.message}`],
            arbre: ast,
            plan_execution: null,
            plan_details: null,
            debug: {
                durationMs: Date.now() - start,
                timings: {
                    parseMs,
                    cardinalityMs,
                    planningMs,
                    executionMs,
                    responseBuildMs
                },
                apiCalls: api.getDebugInfo().apiCalls,
                apiErrors: api.getDebugInfo().errorCount,
                timeoutReached: false
            }
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Estimation de cardinalité pour les clauses ET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parcourt l'AST et estime la cardinalité des clauses simples (constante → variable).
 * Retourne une Map { clauseKey → { count, isLarge, numericCount } }
 * Ne plante jamais : en cas d'erreur, retourne une map vide.
 */
async function estimerCardinalites(ast, api, moteur) {
    const clauses = extraireClausesSimples(ast);
    const map = new Map();

    for (const clause of clauses) {
        try {
            const v1IsVar = clause.variable && clause.variable.startsWith('$');
            const v2IsVar = clause.cible && clause.cible.startsWith('$');

            // On estime uniquement les clauses avec une constante
            if (v1IsVar === v2IsVar) continue; // Deux vars ou deux constantes → skip

            const constante = v1IsVar ? clause.cible : clause.variable;
            const direction = v1IsVar ? 'to' : 'from';
            let relId;
            try { relId = moteur.getRelId(clause.relation); } catch { continue; }

            const estimation = await api.estimateCardinality(constante, relId, direction);
            const key = Heuristiques._clauseKey(clause);
            map.set(key, estimation);
        } catch (_) {
            // Silencieux : on continue sans cette estimation
        }
    }
    return map;
}

/** Extrait toutes les clauses CLAUSE_RELATION de l'AST (parcours récursif) */
function extraireClausesSimples(noeud) {
    if (!noeud) return [];
    if (noeud.type === 'CLAUSE_RELATION') return [noeud];
    if (noeud.type === 'NOEUD_LOGIQUE') {
        return [...extraireClausesSimples(noeud.gauche), ...extraireClausesSimples(noeud.droite)];
    }
    return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes utilitaires
// ─────────────────────────────────────────────────────────────────────────────
app.get('/cache/stats', (req, res) => res.json(cache.getReport()));
app.get('/cache/clear', async (req, res) => {
    await cache.clear();
    res.json({ message: 'Cache vidé avec succès' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Démarrage du serveur
// ─────────────────────────────────────────────────────────────────────────────
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`
    =============================================
    🚀 MOTEUR WIDO — Version Finale TER
    📍 URL : http://localhost:${PORT}
    📦 Cache : Manager Modulaire (MD5/disque)
    🧠 Heuristiques : Structurelle + Cardinalité
    📄 Pagination : limit/offset activé (max 5 pages)
    🛡️  Sécurité : Limites jointures + timeout 120s
    =============================================
    `);
});