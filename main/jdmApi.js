const axios = require('axios');

const JDM_BASE = 'https://jdm-api.demo.lirmm.fr';

/**
 * Couche d'accès à l'API JeuxDeMots (JDM v0).
 * Les IDs JDM sont utilisés pour éviter les ambiguïtés de noms et accélérer les intersections.
 */
class JdmApi {
    constructor(cacheManager, limits) {
        this.cache = cacheManager;
        this.limits = limits || {
            apiTimeoutMs: 15000,
            maxInitialCandidates: 1000
        };
        this.callCount = 0;
        this.errors = [];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Infrastructure
    // ─────────────────────────────────────────────────────────────────────────

    async safeApiCall(url, retries = 2) {
        this.callCount++;
        try {
            const response = await axios.get(url, { timeout: this.limits.apiTimeoutMs });
            return response.data;
        } catch (err) {
            if (retries > 0 && (!err.response || err.response.status >= 500)) {
                await new Promise(r => setTimeout(r, 500));
                return this.safeApiCall(url, retries - 1);
            }
            const errorMsg = err.response ? `HTTP ${err.response.status}` : err.message;
            if (!this.errors.find(e => e.url === url)) {
                this.errors.push({ url, error: errorMsg });
            }
            if (err.response && err.response.status === 404) return null;
            throw err;
        }
    }

    resetDebugInfo() {
        this.callCount = 0;
        this.errors = [];
    }

    // Noms normalisés pour correspondre exactement à ce que node.js lit
    getDebugInfo() {
        return {
            apiCalls: this.callCount,
            errorCount: this.errors.length,
            errors: this.errors
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Résolution de nœuds
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Convertit un nom de mot en nœud JDM { id, name }.
     * Endpoint : GET /v0/node_by_name/{name}
     */
    async resolveNodeByName(name) {
        const key = `node_by_name:${name.toLowerCase().trim()}`;
        const cached = await this.cache.get(key);
        if (cached) return cached;

        const url = `${JDM_BASE}/v0/node_by_name/${encodeURIComponent(name.toLowerCase().trim())}`;
        try {
            const data = await this.safeApiCall(url);
            if (data && data.id) {
                const result = { id: data.id, name: data.name };
                await this.cache.set(key, result);
                return result;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Récupération de relations — VERSION SIMPLE (compatibilité interne)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Récupère les relations depuis/vers un nœud identifié par son NOM.
     * Délègue à getRelationsPaged pour bénéficier de la pagination.
     *
     * direction = "from" : (nodeName relation $x)  →  /relations/from/{nodeName}
     * direction = "to"   : ($x relation nodeName)  →  /relations/to/{nodeName}
     */
    async getRelations(nodeName, relationId, direction = 'from', minWeight = 10, exhaustive = false) {
        const result = await this.getRelationsPaged({
            node: nodeName,
            relationId,
            direction,
            minWeight,
            useId: false,
            exhaustive
        });
        return { resultats: result.resultats, paginationStats: result.paginationStats };
    }

    /**
     * Récupère les relations depuis/vers un nœud identifié par son ID.
     * Plus fiable que par nom car contourne les ambiguïtés.
     *
     * direction = "from" : /relations/from_by_id/{nodeId}
     * direction = "to"   : /relations/to_by_id/{nodeId}
     */
    async getRelationsById(nodeId, nodeName, relationId, direction = 'from', minWeight = 10, exhaustive = false) {
        const result = await this.getRelationsPaged({
            nodeId,
            node: nodeName,
            relationId,
            direction,
            minWeight,
            useId: true,
            exhaustive
        });
        return { resultats: result.resultats, paginationStats: result.paginationStats };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Récupération de relations — VERSION PAGINÉE (cœur du système)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Récupère des relations en boucle (limit + offset) jusqu'à épuisement ou limite.
     *
     * Endpoints utilisés :
     *   useId=false, direction="from" → /v0/relations/from/{node}
     *   useId=false, direction="to"   → /v0/relations/to/{node}
     *   useId=true,  direction="from" → /v0/relations/from_by_id/{nodeId}
     *   useId=true,  direction="to"   → /v0/relations/to_by_id/{nodeId}
     *
     * Paramètres de pagination :
     *   limit    : nombre de relations par page (max recommandé : 1000)
     *   maxPages : nombre max de pages à récupérer (défaut : 5)
     *   maxTotal : nombre max de résultats au total (défaut : 5000)
     *
     * Retourne un objet avec :
     *   resultats, totalFetched, pagesFetched, usedPagination,
     *   stoppedReason, reachedPaginationLimit, apiCalls, paginationStats
     */
    async getRelationsPaged({
        node,
        nodeId,
        relationId,
        direction = 'from',
        useId = false,
        limit = 1000,
        maxPages = 5,
        maxTotal = 5000,
        minWeight = 10,
        exhaustive = false
    }) {
        // Clé de cache stable pour toute la session paginée
        const cacheKey = useId
            ? `relsPaged:${direction}:id:${nodeId}:${relationId}:mw${minWeight}:lim${limit}:mp${maxPages}:mt${maxTotal}:exh${exhaustive}`
            : `relsPaged:${direction}:${node}:${relationId}:mw${minWeight}:lim${limit}:mp${maxPages}:mt${maxTotal}:exh${exhaustive}`;

        const cached = await this.cache.get(cacheKey);
        if (cached) return cached;

        // Construction de l'URL de base selon useId et direction
        let basePath;
        if (useId) {
            basePath = direction === 'from'
                ? `${JDM_BASE}/v0/relations/from_by_id/${nodeId}`
                : `${JDM_BASE}/v0/relations/to_by_id/${nodeId}`;
        } else {
            const encoded = encodeURIComponent(node.toLowerCase().trim());
            basePath = direction === 'from'
                ? `${JDM_BASE}/v0/relations/from/${encoded}`
                : `${JDM_BASE}/v0/relations/to/${encoded}`;
        }

        const allResults = [];
        let offset = 0;
        let page = 0;
        let stoppedReason = 'last_page';
        let apiCallsUsed = 0;

        // ── Boucle de pagination ──────────────────────────────────────────────
        while (true) {
            if (!exhaustive && page >= maxPages) { stoppedReason = 'max_pages_security'; break; }
            if (!exhaustive && allResults.length >= maxTotal) { stoppedReason = 'max_total_security'; break; }
            
            const maxApiCalls = this.limits.maxApiCallsPerQuery || 1000;
            if (this.callCount >= maxApiCalls) { stoppedReason = 'api_calls_limit'; break; }
            
            // Protection anti-boucle infinie stricte (même en exhaustif)
            if (page >= 500) { stoppedReason = 'max_pages_security'; break; }

            const url = `${basePath}?types_ids=${relationId}&min_weight=${minWeight}&limit=${limit}&offset=${offset}`;

            let rawData;
            try {
                rawData = await this.safeApiCall(url);
                apiCallsUsed++;
            } catch (e) {
                stoppedReason = 'api_error';
                break;
            }

            if (!rawData) break;

            // Construire une map id→name depuis les nœuds inclus dans la réponse
            const nodesMap = {};
            if (rawData.nodes) {
                rawData.nodes.forEach(n => { nodesMap[n.id] = n.name; });
            }

            const rels = (rawData.relations || []).filter(rel => rel.w >= minWeight);

            for (const rel of rels) {
                if (!exhaustive && allResults.length >= maxTotal) { stoppedReason = 'max_total_security'; break; }
                // direction=to  → le résultat est le sujet  (node1)
                // direction=from → le résultat est l'objet  (node2)
                const nodeResId = direction === 'to' ? rel.node1 : rel.node2;
                allResults.push({
                    id: nodeResId,
                    name: nodesMap[nodeResId] || `[ID:${nodeResId}]`,
                    poids: rel.w
                });
            }

            page++;
            offset += limit;

            // On arrête si la page est incomplète (plus de données à suivre)
            if (rels.length < limit) {
                stoppedReason = 'last_page';
                break;
            }
            if (!exhaustive && stoppedReason === 'max_total_security') break;
        }
        // ─────────────────────────────────────────────────────────────────────

        // Tri par poids décroissant
        allResults.sort((a, b) => b.poids - a.poids);

        const paginationStats = {
            usedPagination: page > 1 || exhaustive,
            pagesFetched: page,
            totalFetched: allResults.length,
            stoppedReason,
            reachedPaginationLimit: stoppedReason !== 'last_page' && stoppedReason !== 'api_error',
            exhaustiveMode: exhaustive,
            exhaustedApi: stoppedReason === 'last_page',
            lastPageWasIncomplete: stoppedReason === 'last_page',
            apiCalls: apiCallsUsed
        };

        const output = {
            resultats: allResults,
            paginationStats
        };

        await this.cache.set(cacheKey, output);
        return output;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vérification d'une relation précise entre deux nœuds
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Vérifie si la relation (idSource)-[relationId]->(idCible) existe.
     * Endpoint : GET /v0/relations/from_by_id/{idSource}/to_by_id/{idCible}?types_ids={relationId}
     * C'est le meilleur endpoint pour vérifier un couple précis par IDs.
     */
    async checkRelation(idSource, relationId, idCible) {
        // Utiliser l'endpoint from_by_id/to_by_id pour une vérification précise
        const url = `${JDM_BASE}/v0/relations/from_by_id/${idSource}/to_by_id/${idCible}?types_ids=${relationId}`;
        const cacheKey = `check:${idSource}:${relationId}:${idCible}`;

        try {
            let data = await this.cache.get(cacheKey);
            if (!data) {
                data = await this.safeApiCall(url);
                if (data) await this.cache.set(cacheKey, data);
            }
            if (!data || !data.relations) return false;
            return data.relations.length > 0;
        } catch (e) {
            return false;
        }
    }

    /**
     * Estime la cardinalité d'une clause (nombre de résultats attendus).
     * Utilisé par l'heuristique pour trier les clauses ET du moins au plus coûteux.
     * Ne récupère qu'une seule page limitée pour être rapide.
     *
     * Retourne : { count: number|">=limit", cached: boolean }
     */
    async estimateCardinality(node, relationId, direction, minWeight = 10, exhaustive = false) {
        if (exhaustive) {
            // Récupérer tout pour avoir la cardinalité exacte
            const result = await this.getRelationsPaged({
                node, relationId, direction, minWeight, exhaustive: true
            });
            return {
                count: result.resultats.length,
                isLarge: false,
                numericCount: result.resultats.length,
                cardinalityMode: "exact_exhaustive",
                fromCache: false
            };
        }

        const probeLimit = 500; // On sonde avec 500 : si on obtient 500, c'est "grand"
        const cacheKey = `cardinality:${direction}:${node}:${relationId}:mw${minWeight}:exhfalse`;

        const cached = await this.cache.get(cacheKey);
        if (cached) return { ...cached, fromCache: true };

        try {
            const encoded = encodeURIComponent(node.toLowerCase().trim());
            const basePath = direction === 'from'
                ? `${JDM_BASE}/v0/relations/from/${encoded}`
                : `${JDM_BASE}/v0/relations/to/${encoded}`;

            const url = `${basePath}?types_ids=${relationId}&min_weight=${minWeight}&limit=${probeLimit}&offset=0`;
            const rawData = await this.safeApiCall(url);

            if (!rawData) {
                const result = { count: 0, isLarge: false, numericCount: 0, cardinalityMode: "bounded_estimation" };
                await this.cache.set(cacheKey, result);
                return result;
            }

            const rels = (rawData.relations || []).filter(r => r.w >= minWeight);
            const isLarge = rels.length >= probeLimit;
            const result = {
                count: isLarge ? `>=${probeLimit}` : rels.length,
                isLarge,
                numericCount: isLarge ? probeLimit : rels.length,
                cardinalityMode: "bounded_estimation"
            };
            await this.cache.set(cacheKey, result);
            return result;
        } catch (e) {
            return { count: '?', isLarge: false, numericCount: 0, error: e.message };
        }
    }
}

module.exports = JdmApi;
