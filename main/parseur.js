// Cette partie contient la logique algorithmique et mathématique.

/**
 * Objectif : transformer une phrase complexe (rigide) en un graphe (Arbre Syntaxique)
 */
function creerArbreDeDecision(phraseUtilisateur) {
    // ÉTAPE 1 : Nettoyage 
    // "trim()" enlève espaces inutiles de la phrase envoyée
    let phraseNettoyee = phraseUtilisateur.trim();

    // ÉTAPE 2 : Supprimer les "coquilles de protection" 
    // Exemple : "($x r_isa animal)" Le but ici est de ne pas bloquer sur les "()"
    if (phraseNettoyee.startsWith('(') && phraseNettoyee.endsWith(')')) {
        // Vérification que c'est une seule et grande coquille sinon risque de casser et supprimer le début ou fin d'une phrase "($x) OU ($y)"
        if (verifieParentheseSolitaireEtGlobale(phraseNettoyee)) {
            // "slice(1, -1)" dit à l'algorithme : Tranche et enlève le 1er caractère parenthese et pareil à la fin.
            let coeurDeLaPhrase = phraseNettoyee.slice(1, -1).trim();
            // Ici recursivité 
            return creerArbreDeDecision(coeurDeLaPhrase);
        }
    }

    // ÉTAPE 3 : Trouver le mot du milieu de la phrase qu'on estime "le connecteur le moins fort", le "OU".
    // La règle d'un parseur demande de chercher un "OU" qui n'est caché dans aucune parenthèse.
    let positionDuConnecteur = enqueterSurPositionDuMotCle(phraseNettoyee, ' OU ');
    let connecteurMagique = 'OU';

    // Pas de "OU" ? Alors on cherche un "ET" qui nous servirait de tronçonneuse pour couper la phrase à la place.
    if (positionDuConnecteur === -1) { // -1 = pas trouvé du tout
        positionDuConnecteur = enqueterSurPositionDuMotCle(phraseNettoyee, ' ET ');
        connecteurMagique = 'ET';
    }

    // Je pense que ici il faudrait peut etre ajouté le "=" ? 

    // ÉTAPE 4 : DÉCOUPAGE MAJEUR
    // Si la recherche mathématique a réussi à trouver un mot connecteur " OU " ou " ET "
    // On va utiliser l'endroit (coordonnée du positionnement) pour couper le texte là où il se trouve
    if (positionDuConnecteur !== -1) {
        // Extrait le texte du début de la phrase (0) jusqu'à la position de la césure du connecteur
        let morceauA_Gauche = phraseNettoyee.substring(0, positionDuConnecteur);
        // On prend le deuxième fragment restant vers la droite (on ajoute +2 pour esquiver les espaces autour du mot " OU ")
        let morceauDe_Droite = phraseNettoyee.substring(positionDuConnecteur + connecteurMagique.length + 2);

        // Création de l'arbre
        // Javascript enregistre ces objets dans des accolades {}
        return {
            type: 'NOEUD_LOGIQUE',           // Sert à savoir quel étage ou type de données correspond au noeud
            operateur: connecteurMagique,    // "Ou" ou "ET"
            gauche: creerArbreDeDecision(morceauA_Gauche), // uniquement l'échantillon de gauche 
            droite: creerArbreDeDecision(morceauDe_Droite) // Pareil à droite
            // ICI A VERIFIER AVEC LE PROF CAR QUAND Y A 3 () CA MET 2 FOIS DROITE 
        };
    }

  // ÉTAPE 5 : ABSENCE DE CONNECTEURS (CAS FINAL)
    // On nettoie les caractères parasites comme les parenthèses qui resteraient collées
    let textePur = phraseNettoyee.replace(/[()]/g, ' ').trim();
    let motsDivises = textePur.split(' ').filter(petitMot => petitMot.length > 0);

    // Cas Numéro 1 : égalité simple "="
    if (motsDivises[1] === '=') {
        return {
            type: 'CLAUSE_FILTRE',
            variable: motsDivises[0],
            filtre: motsDivises[2]
        };
    }

    // Cas Numéro 2 : Relation (ex: $x r_isa animal)
    return {
        type: 'CLAUSE_RELATION',
        variable: motsDivises[0],
        relation: motsDivises[1],
        cible: motsDivises[2] // Sera maintenant "chat" et non "chat)"
    };
}


/**
 * -------------------------------------------------------------
 * OUTILS SECONDAIRES POUR SUPPORTER L'ALGORITHME PRINCIPAL :
 * -------------------------------------------------------------
 */

/**
 * Objectif ici : compter l'ouverture et fermeture de chaque boucle
 * Dès lors qu'il détecte que son "compteur est à zéro", il entre en "zone sans aucune parenthèse"
 */
function enqueterSurPositionDuMotCle(texte, motCleRecherche) { // Trouver un mot précis (comme "OU"), mais uniquement s'il n'est pas enfermé dans des parenthèses 
    let niveauDeProfondeur = 0;

    // Boucle
    for (let i = 0; i < texte.length - motCleRecherche.length + 1; i++) {
        if (texte[i] === '(') niveauDeProfondeur++; // Si l'algo remarque qu'on entre de plus en plus profondément : IL COMPTE EN PLUS
        if (texte[i] === ')') niveauDeProfondeur--; // S'il quitte la coquille, il compte EN MOINS

        // Dans la fraction de test, SI son relevé niveau est de profondeur ZÉRO c'est le signal à attaquer.
        if (niveauDeProfondeur === 0) {
            // on sectionne brièvement les lettres qui "pourraient" matcher l'éligibilité " OU ".
            let sectionDeLettresLues = texte.substring(i, i + motCleRecherche.length);
            // S'il correspond ! YES ! BINGO.
            if (sectionDeLettresLues === motCleRecherche) {
                return i; // il rend fidèlement la coordonnée ou index à notre Parseur plus haut dans le Code.
            }
        }
    }
    // "-1", c'est ce qu'on renvoie quand le code échoue à trouver pour lui dire "Impossible", Il testera alors un Plan B
    return -1;
}

/**
 * Vérificateur de Fausse parenthèses
 * Empêche le blocage sur un schéma 1 parenthese vs N parentheses
 * Vérifier si TOUT le texte est enfermé dans une seule grosse paire de parenthèses (ex: (A ET B))
 * éviter le piège: (A) ET (B)
 */
function verifieParentheseSolitaireEtGlobale(texte) {
    let niveau = 0;
    // boucle 
    for (let i = 0; i < texte.length - 1; i++) {
        if (texte[i] === '(') niveau++;
        if (texte[i] === ')') niveau--;
        // Si d'une manière  l'indicateur de parenthèses tombe A 0 et qu'on n'est pas à la fin du texte lu : 
        // on identifie une situation piège, alors on met une séparation en plein milieu, donc au moins DEUX GROUPES INDEPENDANTS au lieu d'une englobante
        if (niveau === 0) return false;
    }
    // si la (les) condition n'a jamais "trahie", c'est bien une Unique Coquille surdimensionnée
    return true;
}

// alloue notre fonction 'creerArbreDeDecision' à la mémoire afin que l'autre fichier (Node.js) intègre tout avec simple Require
module.exports = { creerArbreDeDecision };
