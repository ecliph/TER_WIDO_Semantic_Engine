function creerArbreDeDecision(phraseUtilisateur) {
    if (!phraseUtilisateur) throw new Error("Requête vide");
    let phrase = phraseUtilisateur.trim();

    // Gestion des parenthèses englobantes (A ET B) -> A ET B
    if (phrase.startsWith('(') && phrase.endsWith(')')) {
        if (verifieParentheseSolitaireEtGlobale(phrase)) {
            return creerArbreDeDecision(phrase.slice(1, -1).trim());
        }
    }

    // Trouver le connecteur de plus bas niveau (OU d'abord pour respecter la priorité ET > OU)
    // Mais ici le sujet semble demander ET dominant ou simplement séquentiel.
    // Traditionnellement, ET a une priorité plus haute que OU.
    // Donc on cherche OU en premier pour qu'il soit à la racine de l'arbre.
    let pos = enqueterSurPositionDuMotCle(phrase, ' OU ');
    let op = 'OU';

    if (pos === -1) {
        pos = enqueterSurPositionDuMotCle(phrase, ' ET ');
        op = 'ET';
    }

    if (pos !== -1) {
        return {
            type: 'NOEUD_LOGIQUE',
            operateur: op,
            gauche: creerArbreDeDecision(phrase.substring(0, pos).trim()),
            droite: creerArbreDeDecision(phrase.substring(pos + op.length + 2).trim())
        };
    }

    // Cas final : Clause simple ou Filtre
    let textePur = phrase.replace(/[()]/g, ' ').trim();
    let mots = textePur.split(/\s+/).filter(m => m.length > 0);

    if (mots.length === 3) {
        if (mots[1] === '=') {
            return { type: 'CLAUSE_FILTRE', variable: mots[0], filtre: mots[2] };
        }
        return { type: 'CLAUSE_RELATION', variable: mots[0], relation: mots[1], cible: mots[2] };
    }

    if (mots.length < 3) {
        throw new Error(`Syntaxe invalide : clause incomplète "${phrase}"`);
    }

    return { type: 'INCONNU', texte: phrase };
}

function enqueterSurPositionDuMotCle(texte, motCle) {
    let niveau = 0;
    for (let i = 0; i < texte.length - motCle.length + 1; i++) {
        if (texte[i] === '(') niveau++;
        if (texte[i] === ')') niveau--;
        if (niveau === 0) {
            if (texte.substring(i, i + motCle.length).toUpperCase() === motCle.toUpperCase()) {
                return i;
            }
        }
    }
    return -1;
}

function verifieParentheseSolitaireEtGlobale(texte) {
    let niveau = 0;
    for (let i = 0; i < texte.length - 1; i++) {
        if (texte[i] === '(') niveau++;
        if (texte[i] === ')') niveau--;
        if (niveau === 0) return false;
    }
    return true;
}

module.exports = { creerArbreDeDecision };
