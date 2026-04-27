const axios = require('axios');

class JdmApi {
    constructor(cacheManager, limits) {
        this.cache = cacheManager;
        this.limits = limits || {
            apiTimeoutMs: 15000,
            maxInitialCandidates: 200
        };
        this.callCount = 0;
        this.errors = [];
    }

    async safeApiCall(url, retries = 2) {
        this.callCount++;
        try {
            const response = await axios.get(url, { timeout: this.limits.apiTimeoutMs });
            return response.data;
        } catch (err) {
            if (retries > 0 && (!err.response || err.response.status >= 500)) {
                console.warn(`⚠️ Erreur API sur ${url}. Tentative restante : ${retries}`);
                await new Promise(r => setTimeout(r, 1000));
                return this.safeApiCall(url, retries - 1);
            }
            
            const errorMsg = err.response ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
            this.errors.push({ url, error: errorMsg });
            
            if (err.response && err.response.status === 404) return null; // Not found is not a failure for results
            throw err;
        }
    }

    async resolveNodeByName(name) {
        const cached = await this.cache.get(`node_by_name:${name}`);
        if (cached) return cached;

        const url = `https://jdm-api.demo.lirmm.fr/v0/node_by_name/${encodeURIComponent(name.toLowerCase().trim())}`;
        try {
            const data = await this.safeApiCall(url);
            if (data && data.id) {
                const result = { id: data.id, name: data.name };
                await this.cache.set(`node_by_name:${name}`, result);
                return result;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    async getRelations(nodeName, relationId, direction = 'from', minWeight = 10) {
        const cacheKey = `rels:${direction}:${nodeName}:${relationId}:${minWeight}`;
        const cached = await this.cache.get(cacheKey);
        if (cached) return cached;

        const url = `https://jdm-api.demo.lirmm.fr/v0/relations/${direction}/${encodeURIComponent(nodeName)}?types_ids=${relationId}&min_weight=${minWeight}`;
        
        try {
            const rawData = await this.safeApiCall(url);
            if (!rawData) return { resultats: [] };

            const nodesMap = {};
            if (rawData.nodes) {
                rawData.nodes.forEach(n => nodesMap[n.id] = n.name);
            }

            const resultats = (rawData.relations || [])
                .filter(rel => rel.w >= minWeight)
                .map(rel => {
                    const nodeId = direction === 'to' ? rel.node1 : rel.node2;
                    return {
                        id: nodeId,
                        name: nodesMap[nodeId] || `ID: ${nodeId}`,
                        poids: rel.w
                    };
                })
                .sort((a, b) => b.poids - a.poids)
                .slice(0, this.limits.maxInitialCandidates);

            const output = { resultats };
            await this.cache.set(cacheKey, output);
            return output;
        } catch (e) {
            return { resultats: [], error: e.message };
        }
    }

    async checkRelation(idSource, relationId, idCible) {
        const url = `https://jdm-api.demo.lirmm.fr/v0/relations/from/id/${idSource}?types_ids=${relationId}`;
        const cacheKey = `check:${idSource}:${relationId}`;
        
        try {
            let data = await this.cache.get(cacheKey);
            if (!data) {
                data = await this.safeApiCall(url);
                if (data) await this.cache.set(cacheKey, data);
            }
            
            if (!data || !data.relations) return false;
            return data.relations.some(r => r.node2 === idCible);
        } catch (e) {
            return false;
        }
    }

    getDebugInfo() {
        return {
            apiCalls: this.callCount,
            errors: this.errors,
            errorCount: this.errors.length
        };
    }
}

module.exports = JdmApi;
