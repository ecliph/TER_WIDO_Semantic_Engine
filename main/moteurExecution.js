class MoteurExecution {
    constructor(jdmApi, limits) {
        this.api = jdmApi;
        this.limits = limits;
        this.relationsData = require('./relations_wido_optimized.json');
        this.relMap = new Map();
        this.relationsData.relations.forEach(r => this.relMap.set(r.name, r.id));
        this._lastJoinDebug = null;  // persisté entre les étapes de pipeline
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
        // Gère les noeuds OU (qu'ils viennent du planifier ou directement de l'AST)
        if (clause.type === 'OU' || (clause.type === 'NOEUD_LOGIQUE' && clause.operateur === 'OU')) {
            const gauche = clause.gauche;
            const droite = clause.droite;
            // Si les branches sont des plans (tableaux), les exécuter comme plans
            // Sinon les exécuter comme clauses
            const [baseG, baseD] = await Promise.all([
                Array.isArray(gauche) ? this.executerPlan(gauche, contexte) : this.executerClause(gauche, contexte),
                Array.isArray(droite) ? this.executerPlan(droite, contexte) : this.executerClause(droite, contexte)
            ]);
            return this.calculerUnion(baseG, baseD);
        }
        // Gère les noeuds ET imbriqués (récursion cascade)
        if (clause.type === 'NOEUD_LOGIQUE' && clause.operateur === 'ET') {
            let res = contexte;
            res = await this.executerClause(clause.gauche, res);
            if (res.length === 0) return [];
            res = await this.executerClause(clause.droite, res);
            return res;
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
            // Stratégie rapide : 1 seul appel API -> filtrage local (O(1) au lieu de O(N))
            if (contexte.length > 0 && contexte[0][variable]) {
                // ($x rel constante) : isTo=true -> on veut les sujets de constante (direction='to')
                // (constante rel $x) : isTo=false -> on veut les objets de constante (direction='from')
                const fetchDir = isTo ? 'to' : 'from';
                const data = await this.api.getRelations(anchorName, idRel, fetchDir);
                const validIds = new Set((data.resultats || []).map(r => r.id));

                return contexte
                    .filter(tuple => tuple[variable] && validIds.has(tuple[variable].id))
                    .map(tuple => ({
                        ...tuple,
                        __score: (tuple.__score || 0) + 15,
                        __preuves: [...(tuple.__preuves || []), { clause: `(${v1} ${clause.relation} ${v2})`, rel: clause.relation, w: 15 }]
                    }));
            }

            // Sinon c'est une ANCRE (Exploration initiale)
            const data = await this.api.getRelations(anchorName, idRel, direction);
            let nouveauxResults = (data.resultats || []).map(r => ({
                [variable]: { id: r.id, name: r.name },
                __score: r.poids,
                __preuves: [{ clause: `(${v1} ${clause.relation} ${v2})`, rel: clause.relation, w: r.poids }]
            }));

            // Limiter les candidats avant la jointure pour éviter l'explosion cartésienne
            if (contexte.length > 0 && !contexte[0][variable]) {
                const joinCap = this.limits.joinCandidateLimit || 30;
                nouveauxResults = nouveauxResults.slice(0, joinCap);
                return this.calculerJoin(contexte, nouveauxResults);
            }
            return nouveauxResults;
        }

        // Cas : Variable -> Variable (jointure)
        if (contexte.length === 0) {
            throw new Error(`Impossible d'exécuter une jointure variable-variable (${v1}, ${v2}) sans base.`);
        }

        const JOIN_CANDIDATE_LIMIT = this.limits.joinCandidateLimit || 500;
        const EARLY_STOP = this.limits.joinEarlyStop || 1000;
        // Prendre TOUS les candidats dispo jusqu'à la limite
        const candidats = contexte.slice(0, JOIN_CANDIDATE_LIMIT);
        const candidatsDisponibles = contexte.length;
        const wasLimited = contexte.length > JOIN_CANDIDATE_LIMIT;

        const results = [];
        const ancrage = candidats[0][v1] ? v1 : (candidats[0][v2] ? v2 : null);
        if (!ancrage) throw new Error(`Aucune variable du tuple (${v1}, ${v2}) n'est ancrée.`);
        const autre = (ancrage === v1) ? v2 : v1;
        const isAutreKnown = !!candidats[0][autre];

        // Set de tous les IDs de $y valides (construit depuis le contexte complet)
        const knownIds = isAutreKnown
            ? new Set(contexte.map(t => t[autre] && t[autre].id).filter(Boolean))
            : null;

        const direction = (ancrage === v1) ? 'from' : 'to';
        let candidatsTestes = 0;

        for (const tuple of candidats) {
            if (results.length >= EARLY_STOP) break;
            if (!tuple[ancrage]) continue;
            candidatsTestes++;

            const data = await this.api.getRelations(tuple[ancrage].name, idRel, direction);
            for (const r of (data.resultats || [])) {
                if (results.length >= EARLY_STOP) break;
                if (knownIds && !knownIds.has(r.id)) continue;
                results.push({
                    ...tuple,
                    [autre]: { id: r.id, name: r.name },
                    __score: (tuple.__score || 0) + r.poids,
                    __preuves: [...(tuple.__preuves || []), { clause: `(${v1} ${clause.relation} ${v2})`, rel: clause.relation, w: r.poids }]
                });
            }
        }

        // Métadonnées de debug — persistées sur l'instance pour survivre aux transformations de pipeline
        const joinDebug = {
            candidatsTestes,
            candidatsDisponibles,
            couplesTrouves: results.length,
            wasLimited,
            reachedEarlyStop: results.length >= EARLY_STOP
        };
        results._joinDebug = joinDebug;
        this._lastJoinDebug = joinDebug;  // persisté sur l'instance

        const partial = wasLimited || results.length >= EARLY_STOP;
        if (partial) {
            results._joinWarning = `Exploration limitée : ${candidatsTestes} candidat(s) testé(s) ` +
                `sur ${candidatsDisponibles} disponibles ` +
                `(${results.length} couple(s) trouvé(s)).`;
        } else {
            // Exploration complète — seulement avertir si aucun résultat
            if (results.length === 0) {
                results._joinWarning = `Exploration complète : ${candidatsTestes} candidat(s) testé(s) sans couple valide pour la relation ${clause.relation}.`;
            }
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
        this._lastJoinDebug = null;  // réinitialiser à chaque nouvelle plan
        let resultats = contextInitial;
        for (const step of plan) {
            resultats = await this.executerClause(step, resultats);
            if (resultats.length === 0 && step.type !== 'OU' && step.type !== 'NOEUD_LOGIQUE') {
                // Préserver le debug même en cas d'arrêt précoce
                const out = [];
                if (this._lastJoinDebug) out._joinDebug = this._lastJoinDebug;
                return out;
            }
        }
        const sorted = resultats.sort((a, b) => (b.__score || 0) - (a.__score || 0)).slice(0, this.limits.maxResultsReturned);
        // Ré-attacher le debug jointure qui survit aux transformations
        if (this._lastJoinDebug) sorted._joinDebug = this._lastJoinDebug;
        return sorted;
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
        if (l1.length === 0) return l2;
        if (l2.length === 0) return l1;

        const keys1 = Object.keys(l1[0]).filter(k => !k.startsWith('__'));
        const keys2 = Object.keys(l2[0]).filter(k => !k.startsWith('__'));
        const common = keys1.filter(k => keys2.includes(k));
        const cap = this.limits.maxJoinPairs || 5000;

        const res = [];
        outer: for (const t1 of l1) {
            for (const t2 of l2) {
                if (res.length >= cap) break outer;
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
