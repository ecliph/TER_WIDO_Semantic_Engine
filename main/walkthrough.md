# Walkthrough — Projet TER WIDO (Version Finale)

## Objectif

WIDO est un moteur de recherche sémantique permettant d'interroger le graphe de connaissances JeuxDeMots (JDM) via un langage de requêtes formel à variables. Ce document résume les implémentations réalisées, les tests effectués, et les limites connues.

---

## Ce qui a été implémenté

### 1. Parseur syntaxique (`parseur.js`)
- Gère les clauses simples : `($x r_isa animal)`, `(chat r_isa $x)`
- Gère les opérateurs `ET` et `OU` avec priorité correcte (ET > OU)
- Gère les parenthèses imbriquées : `(($x r_isa A) OU ($x r_isa B)) ET ($x = ch%)`
- Gère les filtres textuels : `$x = ba%`
- Retourne une erreur claire pour les clauses incomplètes : `($x r_isa)` → `Erreur de syntaxe`
- Produit un AST exploitable par le planificateur

### 2. Heuristiques (`heuristiques.js`)
- **Complexité structurelle** : score 0.5 à 10 selon le type de clause et les variables ancrées
- **Cardinalité estimée** : appel API sonde avec `limit=500` pour ordonner les clauses ET par taille
- **Plan d'exécution dynamique** : les variables ancrées sont mises à jour à chaque étape
- **`plan_details`** : tableau lisible expliquant le rang et la raison de chaque clause

### 3. API JDM (`jdmApi.js`)
- Endpoints corrects selon la direction : `from` / `to` / `from_by_id` / `to_by_id`
- **Pagination** : boucle `limit`/`offset`, maxPages=5, maxTotal=5000
- **`checkRelation`** corrigé : utilise `/from_by_id/{id}/to_by_id/{id}` (et non `/from/id/`)
- **`estimateCardinality`** : appel léger pour l'heuristique, mis en cache
- Gestion des erreurs : retry 1×, 404 → résultat vide, timeout 15s

### 4. Moteur d'exécution (`moteurExecution.js`)
- **Cas Constante→Variable** : appel `getRelations`, résultats = ancrage initial
- **Cas Variable→Constante ancrée** : 1 seul appel API + filtrage local par Set d'IDs
- **Cas Var→Var** : exploration depuis la variable ancrée via `from_by_id` ou `to_by_id`
- Comparaison par **ID JDM** dans toutes les jointures et intersections
- `joinStats` enrichi : relation, anchorVariable, candidatsTestes, couplesTrouves, usedIdComparison
- `paginationStats` : collecté sur toute la requête et remonté dans la réponse

### 5. Serveur (`node.js`)
- **Erreurs syntaxiques** : HTTP 200 avec `statut: "Erreur"` (plus de HTTP 500 qui cassait le frontend)
- **`debug.apiCalls`** et **`debug.apiErrors`** : champs corrects (les anciens étaient `undefined`)
- Estimation de cardinalité intégrée dans le flux (non bloquante si elle échoue)
- `plan_details` et `paginationStats` inclus dans la réponse JSON

### 6. Interface (`public/script_ter.js`)
- Affichage propre pour le statut `"Erreur"` : bannière rouge + message, jamais de `undefined`
- Panel **joinStats** : candidats testés, couples trouvés, warning si exploration limitée
- Stats **pagination** : pages et relations récupérées
- Fonction `escapeHtml` : sécurité XSS basique
- Preuves avec toggle (bouton `[preuves]` masqué par défaut)

### 7. Benchmark (`benchmark.js`)
- 14 requêtes de test automatisées
- Génère `benchmark_results.json` et `benchmark_results.md`
- Mesure : durée, appels API, cache, pagination, joinStats, planDetails

### 8. Tests (`verify_logic.js`)
- 16 tests couvrant tous les cas : simple, filtre, OU, jointure, 2 variables, 3 variables, erreur syntaxique
- Vérification que les erreurs syntaxiques retournent `statut: "Erreur"` (pas d'undefined)
- Vérification des champs obligatoires (`nb_total`, `debug.apiCalls`, `arbre`)

---

## Tests effectués

| Type | Statut |
|------|--------|
| Requête simple `($x r_isa animal)` | ✅ Fonctionne |
| Filtre `ET ($x = ch%)` | ✅ Fonctionne |
| OU imbriqué | ✅ Fonctionne |
| Jointure ET avec propriété | ✅ Fonctionne |
| Direction inverse `(chat r_isa $x)` | ✅ Fonctionne |
| Requête 2 variables r_can_eat | ⚠️ Fonctionne (0 résultat si JDM incomplet) |
| 3 variables avec filtre | ✅ Fonctionne |
| Erreur syntaxique → message propre | ✅ Corrigé |
| `debug.apiCalls` non undefined | ✅ Corrigé |
| Pagination visible dans l'interface | ✅ Fonctionne |

---

## Limites restantes

1. **`r_can_eat` peu dense dans JDM** : La requête officielle à 2 variables peut retourner 0 couple selon l'état de la base JDM.
2. **API LIRMM instable** : Des erreurs 500 temporaires peuvent survenir sans que le moteur y soit pour quelque chose.
3. **Polysémie non gérée** : Un mot comme "chat" peut avoir plusieurs sens dans JDM. Le moteur prend le nœud canonique.
4. **Pagination à 5000 relations** : Au-delà, les résultats sont tronqués (protection contre les appels excessifs).
5. **Langage formel uniquement** : WIDO ne comprend pas le langage naturel.

---

## Requêtes de démonstration recommandées

1. `($x r_isa animal) ET ($x = ch%)` — rapide, résultats propres
2. `($x r_isa artiste) ET (($x = ba%) OU ($x = Ba%))` — requête officielle du sujet
3. `($x r_isa animal) ET ($x r_has_part queue)` — jointure ET, cardinalité visible
4. `(lion r_can_eat $y) ET ($y r_isa animal)` — proies du lion, plus ciblé que la requête générale
5. `($x r_isa)` — démonstration de la gestion propre des erreurs

---

## Commandes utiles

```bash
# Lancer le serveur
cd main && node node.js

# Lancer les tests (serveur actif requis)
node main/verify_logic.js

# Lancer le benchmark (serveur actif requis)
node main/benchmark.js

# Vider le cache
curl http://localhost:3000/cache/clear

# Voir les stats du cache
curl http://localhost:3000/cache/stats
```

---

© 2026 — Mohamed TEDJINI & Maurice DJOBO

### Séparation des limites et Métriques (Mission 7)

Le moteur distingue désormais trois niveaux de limitation :
1. **Limite de récupération API (Pagination)** : L'API JDM ne remonte qu'un nombre fini de pages (ex: 5 pages). Si cette limite est atteinte, un avertissement indique que des relations supplémentaires pourraient exister.
2. **Limite d'exploration de jointure** : Pour éviter l'explosion combinatoire, les requêtes multi-variables (ex: 2 variables) testent un nombre borné de candidats (ex: 500).
3. **Limite d'affichage final** : Même si le moteur traite des milliers de résultats, l'affichage final est coupé à 1000 pour ne pas surcharger le navigateur. L'avertissement *« Affichage limité »* ne s'affiche **que** si le résultat brut dépasse cette limite.

**Note** : Il est courant qu'une requête affiche peu de résultats (ex: 5 résultats) même si l'API a été bornée à 5000 requêtes. Cela signifie simplement que les filtres ou les jointures subséquentes ont éliminé la majorité des éléments rapatriés.

Le pipeline a été instrumenté pour mesurer précisément chaque étape de la résolution :
- **Parsing** : Temps de construction de l'AST (`parseMs`).
- **Cardinalité** : Temps d'estimation des tailles de relations via des appels API légers (`cardinalityMs`).
- **Planification** : Temps d'exécution de l'heuristique (`planningMs`).
- **Exécution** : Temps réel de récupération et croisement des données (`executionMs`).
- **Appels API** : Comptage exact du nombre de requêtes sortantes vers JDM.
- **Cache** : Nombre de hits et misses du cache local MD5.

Ces métriques sont visibles dans le panneau `Performance` de l'interface graphique et sont intégrées au rapport Markdown généré par `benchmark.js`.
