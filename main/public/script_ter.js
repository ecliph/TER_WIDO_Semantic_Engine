// Variable globale contenant le dictionnaire mis en cache pour ne pas faire de multiples requetes
let JDM_RELATIONS_DICT = null

// Cette fonction charge le fichier JSON une seule fois au demarrage
async function loadRelations() {
    // Si on a deja les relations en memoire on les recupere direct
    if (JDM_RELATIONS_DICT) return JDM_RELATIONS_DICT
    
    try {
        // Demande au navigateur de lire notre fichier de dictionnaire optimise
        let response = await fetch('relations_wido_optimized.json')
        let data = await response.json()
        
        // On le definit sous forme d objet dictionnaire Map pour acces instantane en O 1 au lieu de O n sur tableau list
        JDM_RELATIONS_DICT = {}
        for (let relation of data.relations) {
            JDM_RELATIONS_DICT[relation.name] = relation
        }
        
        console.log("Dictionnaire des relations charge avec succes en cache")
        return JDM_RELATIONS_DICT
    } catch (error) {
        console.error("Erreur lors du chargement de notre dictionnaire", error)
    }
}

// Fonction magique pour traduire un nom ecrit par l humain en ID mathematique
function getRelationInfoByName(nomRelation) {
    if (!JDM_RELATIONS_DICT) return null
    // Acces instantane en complexite O 1 sans jamais parcourir de longue liste
    return JDM_RELATIONS_DICT[nomRelation]
}

// Le but ici est de fouiller l arbre pour recuperer toutes les pieces logiques une par une
function extraireClauses(arbre) {
    let clauses = []
    if (!arbre) return clauses
    
    // Si c est une brique de base on la garde
    if (arbre.type === 'CLAUSE_RELATION') {
        clauses.push(arbre)
    } 
    // Sinon si c est un croisement avec ET ou OU on creuse a gauche et a droite
    else if (arbre.type === 'NOEUD_LOGIQUE') {
        clauses = clauses.concat(extraireClauses(arbre.gauche))
        clauses = clauses.concat(extraireClauses(arbre.droite))
    }
    return clauses
}

// L Heuristique Etape 3 ou on choisit l ordre d execution le plus logique
function trierClausesParContrainte(clauses) {
    // On trie grace a la methode sort
    return clauses.sort((a, b) => {
        let infoA = getRelationInfoByName(a.relation)
        let infoB = getRelationInfoByName(b.relation)
        
        // On lit les fameux scores q constraint
        let scoreA = infoA && infoA.q_constraint ? infoA.q_constraint.score : 0
        let scoreB = infoB && infoB.q_constraint ? infoB.q_constraint.score : 0
        
        // Plus le score est gros plus la clause remonte en priorite absolue
        return scoreB - scoreA
    })
}

// Plus besoin de document.getElementById('btn') car index_ter.html appelle directement lancerRecherche()
async function lancerRecherche() {
    const q = document.getElementById('query').value;
    const resDiv = document.getElementById('resultat');
    const astDiv = document.getElementById('ast-viewer');

    if (!q.trim()) return;

    resDiv.innerHTML = "Recherche en cours... ⏳";
    astDiv.innerHTML = "Fabrication de l'arbre...";
    
    try {
        const response = await fetch(`http://localhost:3000/recherche?q=${encodeURIComponent(q)}`);
        const data = await response.json();

        // 1. Affichage de l'arbre
        astDiv.innerHTML = JSON.stringify(data.arbre, null, 2); 

        // 2. Affichage des résultats dynamiquement en parcourant les tuples de jointure (ex: $x, $y)
        if(data.nb_total > 0 || (data.resultats && data.resultats.length > 0)) {
            resDiv.innerHTML = `<ul>${data.resultats.map((r, index) => {
                let contenuTuple = Object.keys(r).map(variable => 
                    `<div><b>${variable}</b> ${r[variable].name}</div>`
                ).join('');
                return `<li style="animation-delay: ${index * 0.05}s">${contenuTuple}</li>`;
            }).join('')}</ul>`;
        } else {
            resDiv.innerHTML = "<div class='code-block'>Aucun résultat trouvé pour cette requête.</div>";
        }
    } catch (err) {
        resDiv.innerHTML = "❌ Erreur de connexion au serveur (Est-il bien lancé ?).";
    }
}

// Ajout magique pour que la touche "Entrée" fonctionne automatiquement !
document.getElementById('query').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        lancerRecherche();
    }
});