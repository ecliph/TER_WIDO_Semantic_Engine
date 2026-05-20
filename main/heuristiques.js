/**
 * Heuristiques du moteur WIDO.
 *
 * Principe : pour les clauses ET, on exécute en premier les clauses
 * les moins coûteuses (contrainte la plus forte d'abord).
 *
 * Deux niveaux de tri :
 *   1. Complexité structurelle (toujours disponible, rapide)
 *   2. Cardinalité estimée (optionnelle, nécessite un appel API)
 */
class Heuristiques {

    // ─────────────────────────────────────────────────────────────────────────
    // Complexité structurelle
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Score de complexité structurelle d'une clause selon les variables déjà ancrées.
     * Plus le score est faible, plus la clause doit être exécutée tôt.
     *
     *  0.5  Filtre sur variable connue (très rapide, filtrage local)
     *  1    Clause Constante → Variable ou Variable → Constante (ancrage initial)
     *  2    Jointure Var→Var avec deux variables déjà ancrées (vérification)
     *  5    Jointure Var→Var avec une variable ancrée (exploration ciblée)
     *  8    Filtre sur variable inconnue (en attente d'ancrage)
     *  10   Jointure Var→Var sans aucune variable ancrée (interdit en premier)
     */
    static getComplexity(noeud, variablesAncrees = new Set()) {
        if (noeud.type === 'CLAUSE_RELATION') {
            const v1 = noeud.variable;
            const v2 = noeud.cible;
            const v1IsVar = v1 && v1.startsWith('$');
            const v2IsVar = v2 && v2.startsWith('$');

            if (v1IsVar && v2IsVar) {
                const count = (variablesAncrees.has(v1) ? 1 : 0) + (variablesAncrees.has(v2) ? 1 : 0);
                if (count === 2) return 2;  // vérification — très rapide
                if (count === 1) return 5;  // exploration ciblée — moyenne
                return 10;                  // inconnue — interdit en premier
            }
            return 1; // Ancrage par constante — le plus simple
        }
        if (noeud.type === 'CLAUSE_FILTRE') {
            // Filtre local si variable connue (0.5), attente sinon (8)
            return variablesAncrees.has(noeud.variable) ? 0.5 : 8;
        }
        return 3; // Nœud OU imbriqué — complexité intermédiaire
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Planification d'exécution
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Produit un plan d'exécution ordonné à partir d'un AST.
     *
     * Pour les nœuds ET :
     *   - on aplatit toutes les clauses ;
     *   - on les trie dynamiquement par complexité + cardinalité estimée ;
     *   - on met à jour les variables ancrées à chaque étape.
     *
     * Pour les nœuds OU :
     *   - on planifie chaque branche indépendamment.
     *
     * @param {object} noeud - Nœud de l'AST
     * @param {Set} variablesAncrees - Variables déjà résolues au moment du planning
     * @param {Map} cardinalityMap - Optionnel : cardinalité estimée par clause (clé = texte de la clause)
     * @returns {Array} plan d'exécution ordonné
     */
    static planifierExecution(noeud, variablesAncrees = new Set(), cardinalityMap = null) {
        if (noeud.type === 'NOEUD_LOGIQUE') {
            if (noeud.operateur === 'OU') {
                // Chaque branche d'un OU est indépendante : on planifie séparément
                return [{
                    type: 'OU',
                    gauche: this.planifierExecution(noeud.gauche, new Set(variablesAncrees), cardinalityMap),
                    droite: this.planifierExecution(noeud.droite, new Set(variablesAncrees), cardinalityMap)
                }];
            }

            // ET : aplatir et trier par complexité dynamique + cardinalité
            let clauses = this.aplatirET(noeud);
            let plan = [];
            let planDetails = [];
            let currentAncrees = new Set(variablesAncrees);
            let rang = 1;

            while (clauses.length > 0) {
                // Trier par : complexité structurelle d'abord, puis cardinalité estimée si disponible
                clauses.sort((a, b) => {
                    const compA = this.getComplexity(a, currentAncrees);
                    const compB = this.getComplexity(b, currentAncrees);
                    if (compA !== compB) return compA - compB;

                    // Égalité de complexité : trier par cardinalité estimée (plus petite d'abord)
                    if (cardinalityMap) {
                        const keyA = this._clauseKey(a);
                        const keyB = this._clauseKey(b);
                        const cardA = cardinalityMap.get(keyA);
                        const cardB = cardinalityMap.get(keyB);
                        const numA = cardA ? (cardA.numericCount || 9999) : 9999;
                        const numB = cardB ? (cardB.numericCount || 9999) : 9999;
                        return numA - numB;
                    }
                    return 0;
                });

                const cible = clauses.shift();
                plan.push(cible);

                // Enrichir les détails du plan pour le debug et le rapport
                const complexity = this.getComplexity(cible, currentAncrees);
                const cardKey = this._clauseKey(cible);
                const cardInfo = cardinalityMap ? cardinalityMap.get(cardKey) : null;

                planDetails.push({
                    rang,
                    clause: this._clauseText(cible),
                    structuralComplexity: complexity,
                    estimatedCardinality: cardInfo ? cardInfo.count : null,
                    reason: this._explainReason(cible, complexity, cardInfo, currentAncrees)
                });
                rang++;

                // Mettre à jour les variables ancrées après exécution simulée
                if (cible.type === 'CLAUSE_RELATION') {
                    if (cible.variable && cible.variable.startsWith('$')) currentAncrees.add(cible.variable);
                    if (cible.cible && cible.cible.startsWith('$')) currentAncrees.add(cible.cible);
                }
                if (cible.type === 'CLAUSE_FILTRE') {
                    if (cible.variable && cible.variable.startsWith('$')) currentAncrees.add(cible.variable);
                }
            }

            // Attacher les détails du plan au premier élément pour les transmettre
            if (plan.length > 0) plan._planDetails = planDetails;
            return plan;
        }

        // Clause unique (pas de ET/OU à la racine)
        return [noeud];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Utilitaires internes
    // ─────────────────────────────────────────────────────────────────────────

    /** Aplatit un sous-arbre ET en tableau de clauses */
    static aplatirET(noeud) {
        if (noeud.type === 'NOEUD_LOGIQUE' && noeud.operateur === 'ET') {
            return [...this.aplatirET(noeud.gauche), ...this.aplatirET(noeud.droite)];
        }
        return [noeud];
    }

    /** Génère une clé stable pour identifier une clause dans la cardinalityMap */
    static _clauseKey(clause) {
        if (clause.type === 'CLAUSE_RELATION') {
            return `${clause.variable}|${clause.relation}|${clause.cible}`;
        }
        if (clause.type === 'CLAUSE_FILTRE') {
            return `${clause.variable}|=|${clause.filtre}`;
        }
        return JSON.stringify(clause);
    }

    /** Représentation textuelle lisible d'une clause */
    static _clauseText(clause) {
        if (clause.type === 'CLAUSE_RELATION') return `(${clause.variable} ${clause.relation} ${clause.cible})`;
        if (clause.type === 'CLAUSE_FILTRE') return `(${clause.variable} = ${clause.filtre})`;
        if (clause.type === 'OU') return `(... OU ...)`;
        return clause.type;
    }

    /** Explication humaine du choix de rang dans le plan */
    static _explainReason(clause, complexity, cardInfo, ancrees) {
        if (clause.type === 'CLAUSE_FILTRE') {
            return ancrees.has(clause.variable)
                ? `Filtre local sur variable déjà ancrée (très rapide)`
                : `Filtre en attente d'ancrage de la variable`;
        }
        if (clause.type === 'CLAUSE_RELATION') {
            const v1 = clause.variable;
            const v2 = clause.cible;
            const v1IsVar = v1 && v1.startsWith('$');
            const v2IsVar = v2 && v2.startsWith('$');

            if (!v1IsVar || !v2IsVar) {
                const cardStr = cardInfo ? `, cardinalité estimée : ${cardInfo.count}` : '';
                return `Ancrage initial par constante${cardStr}`;
            }

            const knownCount = (ancrees.has(v1) ? 1 : 0) + (ancrees.has(v2) ? 1 : 0);
            if (knownCount === 2) return `Vérification de jointure (2 variables déjà ancrées)`;
            if (knownCount === 1) return `Exploration ciblée depuis variable ancrée`;
            return `Jointure inconnue — reportée après ancrage`;
        }
        return `Complexité ${complexity}`;
    }
}

module.exports = Heuristiques;
