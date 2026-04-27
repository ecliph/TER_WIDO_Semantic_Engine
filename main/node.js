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

// Configuration des Limites
const LIMITS = {
    maxInitialCandidates: 500,
    maxJoinPairs: 5000,
    maxApiCallsPerQuery: 100,
    apiTimeoutMs: 15000,
    maxResultsReturned: 200
};

// Initialisation des couches
const cache = new CacheManager(path.join(__dirname, 'cache'));
const api = new JdmApi(cache, LIMITS);
const moteur = new MoteurExecution(api, LIMITS);

app.get('/recherche', async (req, res) => {
    const q = req.query.q;
    const start = Date.now();
    
    if (!q) return res.status(400).json({ statut: "Erreur", message: "Paramètre q manquant" });

    try {
        // 1. Parsing
        const ast = creerArbreDeDecision(q);

        // 2. Planning (Heuristiques)
        const plan = Heuristiques.planifierExecution(ast);

        // 3. Execution
        const resultats = await moteur.executerPlan(plan);

        const duration = Date.now() - start;
        const apiInfo = api.getDebugInfo();

        res.json({
            statut: apiInfo.errorCount > 0 ? "Succès partiel" : "Succès",
            query: q,
            nb_total: resultats.length,
            resultats: resultats,
            warnings: apiInfo.errors.map(e => `Échec API: ${e.url} (${e.error})`),
            arbre: ast,
            plan_execution: plan,
            debug: {
                ...apiInfo,
                ...cache.getReport(),
                durationMs: duration
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