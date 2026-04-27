class Heuristiques {
    static getComplexity(noeud, variablesAncrees = new Set()) {
        if (noeud.type === 'CLAUSE_RELATION') {
            const v1 = noeud.variable;
            const v2 = noeud.cible;
            const v1IsVar = v1 && v1.startsWith('$');
            const v2IsVar = v2 && v2.startsWith('$');

            if (v1IsVar && v2IsVar) {
                const count = (variablesAncrees.has(v1) ? 1 : 0) + (variablesAncrees.has(v2) ? 1 : 0);
                if (count === 2) return 2; // Vérification (très simple)
                if (count === 1) return 5; // Exploration (moyenne)
                return 10; // Inconnu (complexe/interdit au début)
            }
            return 1; // Ancrage constant (le plus simple)
        }
        if (noeud.type === 'CLAUSE_FILTRE') {
            return variablesAncrees.has(noeud.variable) ? 0.5 : 8; // Filtre local (prioritaire si variable connue)
        }
        return 3;
    }

    static planifierExecution(noeud, variablesAncrees = new Set()) {
        if (noeud.type === 'NOEUD_LOGIQUE') {
            if (noeud.operateur === 'OU') {
                // Pour un OU, on évalue chaque branche indépendamment
                return [{ 
                    type: 'OU', 
                    gauche: this.planifierExecution(noeud.gauche, new Set(variablesAncrees)),
                    droite: this.planifierExecution(noeud.droite, new Set(variablesAncrees))
                }];
            }
            
            // Pour un ET, on aplatit et on trie par complexité dynamique
            let clauses = this.aplatirET(noeud);
            let plan = [];
            let currentAncrees = new Set(variablesAncrees);

            while (clauses.length > 0) {
                // Trier les clauses restantes par complexité selon ce qui est déjà ancré
                clauses.sort((a, b) => this.getComplexity(a, currentAncrees) - this.getComplexity(b, currentAncrees));
                
                const cible = clauses.shift();
                plan.push(cible);

                // Mettre à jour les variables ancrées
                if (cible.type === 'CLAUSE_RELATION') {
                    if (cible.variable && cible.variable.startsWith('$')) currentAncrees.add(cible.variable);
                    if (cible.cible && cible.cible.startsWith('$')) currentAncrees.add(cible.cible);
                }
            }
            return plan;
        }
        return [noeud];
    }

    static aplatirET(noeud) {
        if (noeud.type === 'NOEUD_LOGIQUE' && noeud.operateur === 'ET') {
            return [...this.aplatirET(noeud.gauche), ...this.aplatirET(noeud.droite)];
        }
        return [noeud];
    }
}

module.exports = Heuristiques;
