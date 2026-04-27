const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');

// Modules importés
const CacheManager = require('./cacheManager');
const JdmApi = require('./jdmApi');
const Heuristiques = require('./heuristiques');
const MoteurExecution = require('./moteurExecution');
const { creerArbreDeDecision } = require('./parseur.js');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index_ter.html')));


// Configuration des Limites
const LIMITS = {
    maxInitialCandidates: 1000,
    maxJoinPairs: 10000,
    joinCandidateLimit: 500,
    joinEarlyStop: 1000,
    maxApiCallsPerQuery: 1000,
    apiTimeoutMs: 15000,
    maxResultsReturned: 1000,
    maxQueryDurationMs: 120000
};

// Initialisation des couches
const cache = new CacheManager(path.join(__dirname, 'cache'));
const api = new JdmApi(cache, LIMITS);
const moteur = new MoteurExecution(api, LIMITS);

app.get('/recherche', async (req, res) => {
    const q = req.query.q;
    const start = Date.now();
    
    if (!q) return res.status(400).json({ statut: "Erreur", message: "Paramètre q manquant" });

    // Réinitialiser les erreurs à chaque nouvelle requête
    api.resetDebugInfo();

    try {
        // 1. Parsing
        const ast = creerArbreDeDecision(q);

        // 2. Planning (Heuristiques)
        const plan = Heuristiques.planifierExecution(ast);

        // 3. Execution avec timeout global
        const MAX_DURATION = LIMITS.maxQueryDurationMs || 30000;
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
                resultats._joinWarning = `Requête arrêtée après ${MAX_DURATION/1000}s (délai maximum dépassé). Résultats partiels.`;
            } else {
                throw timeoutErr;
            }
        }

        const duration = Date.now() - start;
        const apiInfo = api.getDebugInfo();

        // Collecter et dédupliquer les warnings
        const seenUrls = new Set();
        const warnings = [];

        // Un seul warning générique si des erreurs API existent
        const apiErrors = apiInfo.errors.filter(e => !seenUrls.has(e.url) && seenUrls.add(e.url));
        if (apiErrors.length > 0) {
            warnings.push(`L'API JeuxDeMots n'a pas répondu correctement pour ${apiErrors.length} appel(s). Les résultats affichés sont partiels.`);
        }

        // Warning jointure 2 variables (déjà court et lisible)
        if (resultats._joinWarning) warnings.push(resultats._joinWarning);

        const cleanResultats = Array.isArray(resultats) ? resultats : [];
        const hasErrors = apiErrors.length > 0 || !!resultats._joinWarning;
        const isLimited = cleanResultats.length >= LIMITS.maxResultsReturned;

        if (isLimited) warnings.push(`Affichage limité aux ${LIMITS.maxResultsReturned} meilleurs résultats.`);

        res.json({
            statut: hasErrors ? "Succès partiel" : "Succès",
            query: q,
            nb_total: cleanResultats.length,
            resultats: cleanResultats,
            warnings,
            arbre: ast,
            plan_execution: plan,
            debug: {
                apiCalls: apiInfo.appelsApiCount,
                apiErrors: apiInfo.erreursApiCount,
                ...cache.getReport(),
                durationMs: duration,
                timeoutReached: timedOut || false,
                joinStats: resultats._joinDebug || null
            }
        });

    } catch (err) {
        console.error("❌ Erreur de requête:", err.message);
        res.status(500).json({
            statut: "Erreur",
            message: err.message,
            query: q,
            debug: { durationMs: Date.now() - start }
        });
    }
});

// Route stats cache
app.get('/cache/stats', (req, res) => res.json(cache.getReport()));
app.get('/cache/clear', async (req, res) => {
    await cache.clear();
    res.json({ message: "Cache vidé avec succès" });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`
    =============================================
    🚀 MOTEUR WIDO STABILISÉ (V4.0)
    📍 URL : http://localhost:${PORT}
    📦 Cache : Manager Modulaire
    🧠 Heuristiques : Actives (Mission 4)
    🛡️ Sécurité : Limites de Jointures Actives
    =============================================
    `);
});