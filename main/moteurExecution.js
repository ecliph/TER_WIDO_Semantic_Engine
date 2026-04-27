class MoteurExecution {
    constructor(jdmApi, limits) {
        this.api = jdmApi;
        this.limits = limits;
        this.relationsData = require('./relations_wido_optimized.json');
        this.relMap = new Map();
        this.relationsData.relations.forEach(r => this.relMap.set(r.name, r.id));
    }

    getRelId(name) {
        if (this.relMap.has(name)) return this.relMap.get(name);
        if (!isNaN(name)) return parseInt(name);
        throw new Error(`Relation inconnue : "${name}"`);
    }

    async executerClause(clause, contexte = []) {
        if (clause.type === 'CLAUSE_RELATION') {
            return await this.handleRelation(clause, contexte);
        }
        if (clause.type === 'CLAUSE_FILTRE') {
            return this.handleFilter(clause, contexte);
        }
        if (clause.type === 'OU') {
            const [baseG, baseD] = await Promise.all([
                this.executerPlan(clause.gauche, contexte),
                this.executerPlan(clause.droite, contexte)
            ]);
            return this.calculerUnion(baseG, baseD);
        }
        return contexte;
    }

    async handleRelation(clause, contexte) {
        const idRel = this.getRelId(clause.relation);
        const v1 = clause.variable;
        const v2 = clause.cible;
        const v1IsVar = v1 && v1.startsWith('$');
        const v2IsVar = v2 && v2.startsWith('$');

        // Cas : Constante -> Variable ou Variable -> Constante
        if (!v1IsVar || !v2IsVar) {
            const isTo = v1IsVar;
            const anchorName = isTo ? v2 : v1;
            const variable = isTo ? v1 : v2;
            const direction = isTo ? 'to' : 'from';

            // Si la variable est déjà ancrée, c'est une VÉRIFICATION
            if (contexte.length > 0 && contexte[0][variable]) {
                const results = [];
                // On doit résoudre l'anchorName en ID pour checkRelation
                const anchorNode = await this.api.resolveNodeByName(anchorName);
                if (!anchorNode) return [];

                for (const tuple of contexte) {
                    const ok = isTo 
                        ? await this.api.checkRelation(anchorNode.id, idRel, tuple[variable].id)
                        : await this.api.checkRelation(tuple[variable].id, idRel, anchorNode.id);
                    if (ok) {
                        const clone = { ...tuple };
                        clone.__score = (clone.__score || 0) + 15;
                        clone.__preuves = [...(clone.__preuves || []), { clause: `(${v1} ${clause.relation} ${v2})`, rel: clause.relation, w: 15 }];
                        results.push(clone);
                    }
                }
                return results;
            }

            // Sinon c'est une ANCRE (Exploration initiale)
            const data = await this.api.getRelations(anchorName, idRel, direction);
            const nouveauxResults = (data.resultats || []).map(r => ({
                [variable]: { id: r.id, name: r.name },
                __score: r.poids,
                __preuves: [{ clause: `(${v1} ${clause.relation} ${v2})`, rel: clause.relation, w: r.poids }]
            }));

            if (contexte.length > 0 && !contexte[0][variable]) {
                return this.calculerJoin(contexte, nouveauxResults);
            }
            return nouveauxResults;
        }

        // Cas : Variable -> Variable
        if (contexte.length === 0) {
            throw new Error(`Impossible d'exécuter une jointure variable-variable (${v1}, ${v2}) sans base.`);
        }

        const results = [];
        const ancrage = contexte[0][v1] ? v1 : (contexte[0][v2] ? v2 : null);
        
        if (!ancrage) throw new Error(`Aucune variable du tuple (${v1}, ${v2}) n'est ancrée.`);

        const autre = (ancrage === v1) ? v2 : v1;
        const isAncrageKnown = true; // Inferred from test
        const isAutreKnown =!!contexte[0][autre];

        for (const tuple of contexte) {
            if (isAncrageKnown && isAutreKnown) {
                // Vérification
                const ok = await this.api.checkRelation(tuple[v1].id, idRel, tuple[v2].id);
                if (ok) {
                    const clone = { ...tuple };
                    clone.__score = (clone.__score || 0) + 10; // Arbitrary verification bonus
                    clone.__preuves = [...(clone.__preuves || []), { clause: `(${v1} ${clause.relation} ${v2})`, rel: clause.relation, w: 10 }];
                    results.push(clone);
                }
            } else {
                // Exploration
                const direction = (ancrage === v1) ? 'from' : 'to';
                const data = await this.api.getRelations(tuple[ancrage].name, idRel, direction);
                (data.resultats || []).forEach(r => {
                    const newTuple = { 
                        ...tuple, 
                        [autre]: { id: r.id, name: r.name },
                        __score: (tuple.__score || 0) + r.poids,
                        __preuves: [...(tuple.__preuves || []), { clause: `(${v1} ${clause.relation} ${v2})`, rel: clause.relation, w: r.poids }]
                    };
                    results.push(newTuple);
                });
            }
            if (results.length > this.limits.maxJoinPairs) break;
        }
        return results;
    }

    handleFilter(clause, contexte) {
        const v = clause.variable;
        const pattern = clause.filtre;
        const regex = new RegExp('^' + pattern.replace(/%/g, '.*') + '$', 'i');
        
        return contexte.filter(tuple => {
            if (!tuple[v]) return false;
            return regex.test(tuple[v].name);
        });
    }

    async executerPlan(plan, contextInitial = []) {
        let resultats = contextInitial;
        for (const step of plan) {
            resultats = await this.executerClause(step, resultats);
            if (resultats.length === 0 && step.type !== 'OU') {
                return [];
            }
        }
        return resultats.sort((a, b) => (b.__score || 0) - (a.__score || 0)).slice(0, this.limits.maxResultsReturned);
    }

    calculerUnion(l1, l2) {
        const map = new Map();
        const merge = (tuple) => {
            const key = Object.keys(tuple).filter(k => !k.startsWith('__')).sort().map(k => `${k}:${tuple[k].id}`).join('|');
            if (map.has(key)) {
                const existing = map.get(key);
                if ((tuple.__score || 0) > (existing.__score || 0)) map.set(key, tuple);
            } else {
                map.set(key, tuple);
            }
        };
        l1.forEach(merge);
        l2.forEach(merge);
        return Array.from(map.values());
    }

    calculerJoin(l1, l2) {
        // Implementation for joining two independent set of results
        // Standard inner join on common variables
        if (l1.length === 0) return l2;
        if (l2.length === 0) return l1;

        const keys1 = Object.keys(l1[0]).filter(k => !k.startsWith('__'));
        const keys2 = Object.keys(l2[0]).filter(k => !k.startsWith('__'));
        const common = keys1.filter(k => keys2.includes(k));

        const res = [];
        for (const t1 of l1) {
            for (const t2 of l2) {
                let match = true;
                for (const c of common) {
                    if (t1[c].id !== t2[c].id) { match = false; break; }
                }
                if (match) {
                    res.push({
                        ...t1, ...t2,
                        __score: (t1.__score || 0) + (t2.__score || 0),
                        __preuves: [...(t1.__preuves || []), ...(t2.__preuves || [])]
                    });
                }
            }
        }
        return res;
    }
}

module.exports = MoteurExecution;
