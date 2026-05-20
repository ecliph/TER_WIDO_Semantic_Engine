/**
 * Moteur d'exécution de requêtes WIDO.
 *
 * Principe de comparaison par ID :
 *   Toutes les jointures et intersections utilisent les IDs JDM pour éviter
 *   les ambiguïtés de noms et garantir des comparaisons exactes.
 *   Les noms sont conservés uniquement pour l'affichage.
 */
class MoteurExecution {
    constructor(jdmApi, limits) {
        this.api = jdmApi;
        this.limits = limits;
        this.relationsData = require('./relations_wido_optimized.json');
        this.relMap = new Map();
        this.relationsData.relations.forEach(r => this.relMap.set(r.name, r.id));
        this._lastJoinDebug = null;
        this._paginationStats = [];  // collecte tous les paginationStats de la requête
    }

    getRelId(name) {
        if (this.relMap.has(name)) return this.relMap.get(name);
        if (!isNaN(name)) return parseInt(name);
        throw new Error(`Relation inconnue : "${name}". Vérifiez le dictionnaire des relations JDM.`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Point d'entrée principal
    // ─────────────────────────────────────────────────────────────────────────

    async executerClause(clause, contexte = []) {
        if (clause.type === 'CLAUSE_RELATION') {
            return await this.handleRelation(clause, contexte);
        }
        if (clause.type === 'CLAUSE_FILTRE') {
            return this.handleFilter(clause, contexte);
        }
        // Nœud OU (venant du planificateur ou directement de l'AST)
        if (clause.type === 'OU' || (clause.type === 'NOEUD_LOGIQUE' && clause.operateur === 'OU')) {
            const gauche = clause.gauche;
            const droite = clause.droite;
            const [baseG, baseD] = await Promise.all([
                Array.isArray(gauche) ? this.executerPlan(gauche, contexte) : this.executerClause(gauche, contexte),
                Array.isArray(droite) ? this.executerPlan(droite, contexte) : this.executerClause(droite, contexte)
            ]);
            return this.calculerUnion(baseG, baseD);
        }
        // Nœud ET imbriqué (ne devrait plus arriver après le planificateur, mais par sécurité)
        if (clause.type === 'NOEUD_LOGIQUE' && clause.operateur === 'ET') {
            let res = contexte;
            res = await this.executerClause(clause.gauche, res);
            if (res.length === 0) return [];
            res = await this.executerClause(clause.droite, res);
            return res;
        }
        return contexte;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Traitement des clauses de relation
    // ─────────────────────────────────────────────────────────────────────────

    async handleRelation(clause, contexte) {
        const idRel = this.getRelId(clause.relation);
        const v1 = clause.variable;
        const v2 = clause.cible;
        const v1IsVar = v1 && v1.startsWith('$');
        const v2IsVar = v2 && v2.startsWith('$');

        // ── Cas 1 : Une constante, une variable (ancrage ou vérification) ──────
        if (!v1IsVar || !v2IsVar) {
            const isTo = v1IsVar;         // ($x rel CONSTANTE) → direction "to"
            const anchorName = isTo ? v2 : v1;
            const variable = isTo ? v1 : v2;
            const direction = isTo ? 'to' : 'from';

            // La variable est déjà ancrée → VÉRIFICATION par intersection locale
            // Stratégie : 1 seul appel API, construction d'un Set d'IDs valides, filtrage O(1)
            if (contexte.length > 0 && contexte[0][variable]) {
                const data = await this.api.getRelations(anchorName, idRel, direction);
                if (data.paginationStats) this._paginationStats.push(data.paginationStats);

                // Comparaison par ID JDM (pas par nom, pour éviter les ambiguïtés)
                const validIds = new Set((data.resultats || []).map(r => r.id));

                return contexte
                    .filter(tuple => tuple[variable] && validIds.has(tuple[variable].id))
                    .map(tuple => ({
                        ...tuple,
                        __score: (tuple.__score || 0) + 15,
                        __preuves: [...(tuple.__preuves || []), {
                            clause: `(${v1} ${clause.relation} ${v2})`,
                            rel: clause.relation, w: 15
                        }]
                    }));
            }

            // La variable n'est pas encore ancrée → EXPLORATION initiale (paginée)
            const data = await this.api.getRelations(anchorName, idRel, direction);
            if (data.paginationStats) this._paginationStats.push(data.paginationStats);

            let nouveauxResults = (data.resultats || []).map(r => ({
                [variable]: { id: r.id, name: r.name },
                __score: r.poids,
                __preuves: [{ clause: `(${v1} ${clause.relation} ${v2})`, rel: clause.relation, w: r.poids }]
            }));

            // Si un contexte existe avec d'autres variables, faire une jointure
            if (contexte.length > 0 && !contexte[0][variable]) {
                const joinCap = this.limits.joinCandidateLimit || 30;
                nouveauxResults = nouveauxResults.slice(0, joinCap);
                return this.calculerJoin(contexte, nouveauxResults);
            }
            return nouveauxResults;
        }

        // ── Cas 2 : Deux variables (jointure) ───────────────────────────────
        if (contexte.length === 0) {
            throw new Error(
                `Impossible d'exécuter une jointure (${v1} ${clause.relation} ${v2}) : ` +
                `aucune variable n'est encore ancrée. Vérifiez l'ordre des clauses.`
            );
        }

        const JOIN_CANDIDATE_LIMIT = this.limits.joinCandidateLimit || 500;
        const EARLY_STOP = this.limits.joinEarlyStop || 1000;

        const candidats = contexte.slice(0, JOIN_CANDIDATE_LIMIT);
        const candidatsDisponibles = contexte.length;
        const wasLimited = contexte.length > JOIN_CANDIDATE_LIMIT;

        const results = [];
        const ancrage = candidats[0][v1] ? v1 : (candidats[0][v2] ? v2 : null);
        if (!ancrage) throw new Error(`Aucune variable du tuple (${v1}, ${v2}) n'est ancrée.`);
        const autre = (ancrage === v1) ? v2 : v1;
        const isAutreKnown = !!candidats[0][autre];

        // Set de tous les IDs valides de la variable "autre" (si déjà connue)
        // Comparaison par ID pour éviter les ambiguïtés de noms
        const knownIds = isAutreKnown
            ? new Set(contexte.map(t => t[autre] && t[autre].id).filter(Boolean))
            : null;

        const direction = (ancrage === v1) ? 'from' : 'to';
        let candidatsTestes = 0;
        let usedIdComparison = false;

        for (const tuple of candidats) {
            if (results.length >= EARLY_STOP) break;
            if (!tuple[ancrage]) continue;
            candidatsTestes++;

            // Préférer from_by_id/to_by_id si on connaît l'ID (plus fiable)
            let data;
            if (tuple[ancrage].id) {
                data = await this.api.getRelationsById(
                    tuple[ancrage].id,
                    tuple[ancrage].name,
                    idRel,
                    direction
                );
                usedIdComparison = true;
            } else {
                data = await this.api.getRelations(tuple[ancrage].name, idRel, direction);
            }
            if (data.paginationStats) this._paginationStats.push(data.paginationStats);

            for (const r of (data.resultats || [])) {
                if (results.length >= EARLY_STOP) break;
                // Comparaison par ID JDM (pas par nom)
                if (knownIds && !knownIds.has(r.id)) continue;
                results.push({
                    ...tuple,
                    [autre]: { id: r.id, name: r.name },
                    __score: (tuple.__score || 0) + r.poids,
                    __preuves: [...(tuple.__preuves || []), {
                        clause: `(${v1} ${clause.relation} ${v2})`,
                        rel: clause.relation, w: r.poids
                    }]
                });
            }
        }

        // Métadonnées de jointure (persistées sur l'instance pour survivre aux transformations)
        const joinDebug = {
            relation: clause.relation,
            anchorVariable: ancrage,
            discoveredVariable: autre,
            candidatsDisponibles,
            candidatsTestes,
            couplesTrouves: results.length,
            wasLimited,
            reachedEarlyStop: results.length >= EARLY_STOP,
            usedDirectExploration: true,
            usedIdComparison
        };
        results._joinDebug = joinDebug;
        this._lastJoinDebug = joinDebug;

        // Warning informatif sur l'exploration
        const partial = wasLimited || results.length >= EARLY_STOP;
        if (partial) {
            results._joinWarning =
                `Exploration limitée : ${candidatsTestes} candidat(s) testé(s) sur ${candidatsDisponibles} disponibles ` +
                `(${results.length} couple(s) trouvé(s) pour la relation ${clause.relation}).`;
        } else if (results.length === 0) {
            results._joinWarning =
                `Exploration complète : ${candidatsTestes} candidat(s) testé(s), ` +
                `aucun couple valide trouvé pour la relation "${clause.relation}" ` +
                `dans la portion explorée.`;
        }

        return results;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Traitement des filtres textuels
    // ─────────────────────────────────────────────────────────────────────────

    handleFilter(clause, contexte) {
        const v = clause.variable;
        const pattern = clause.filtre;
        // Transformer le wildcard % en regex .*
        const regex = new RegExp('^' + pattern.replace(/%/g, '.*') + '$', 'i');

        return contexte.filter(tuple => {
            if (!tuple[v]) return false;
            return regex.test(tuple[v].name);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Exécution d'un plan complet
    // ─────────────────────────────────────────────────────────────────────────

    async executerPlan(plan, contextInitial = []) {
        this._lastJoinDebug = null;
        this._paginationStats = [];
        let resultats = contextInitial;

        for (const step of plan) {
            resultats = await this.executerClause(step, resultats);
            // Arrêt précoce si une étape renvoie 0 résultats (sauf OU)
            if (resultats.length === 0 && step.type !== 'OU' && step.type !== 'NOEUD_LOGIQUE') {
                const out = [];
                if (this._lastJoinDebug) out._joinDebug = this._lastJoinDebug;
                out._paginationStats = this._paginationStats;
                return out;
            }
        }

        const sorted = resultats
            .sort((a, b) => (b.__score || 0) - (a.__score || 0))
            .slice(0, this.limits.maxResultsReturned);

        // Ré-attacher les métadonnées qui survivent aux transformations de tableau
        if (this._lastJoinDebug) sorted._joinDebug = this._lastJoinDebug;
        sorted._paginationStats = this._paginationStats;

        return sorted;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Opérations ensemblistes
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Union de deux listes de tuples.
     * En cas de doublon (même clé d'IDs), on conserve le tuple avec le meilleur score.
     */
    calculerUnion(l1, l2) {
        const map = new Map();
        const merge = (tuple) => {
            const key = Object.keys(tuple)
                .filter(k => !k.startsWith('__'))
                .sort()
                .map(k => `${k}:${tuple[k] && tuple[k].id}`)
                .join('|');
            const existing = map.get(key);
            if (!existing || (tuple.__score || 0) > (existing.__score || 0)) {
                map.set(key, tuple);
            }
        };
        l1.forEach(merge);
        l2.forEach(merge);
        return Array.from(map.values());
    }

    /**
     * Jointure de deux listes de tuples sur les variables communes.
     * Comparaison par ID JDM (pas par nom) pour éviter les ambiguïtés.
     */
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
                    // Comparaison par ID JDM — plus robuste que par nom
                    if (!t1[c] || !t2[c] || t1[c].id !== t2[c].id) {
                        match = false;
                        break;
                    }
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
