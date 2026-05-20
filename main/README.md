# WIDO — Moteur Sémantique (Projet TER)

WIDO est un moteur de recherche sémantique qui interroge dynamiquement le graphe de connaissances **JeuxDeMots (JDM)** via son API officielle v0. Il interprète des requêtes formelles à variables, les parse en arbre de décision (AST), planifie leur exécution avec des heuristiques, et croise les résultats par des jointures ensemblistes basées sur les IDs.

**Auteurs** : Mohamed TEDJINI & Maurice DJOBO — Master ICO 2026

---

## Fonctionnalités

- **Langage de requêtes** : variables (`$x`, `$y`), relations JDM, opérateurs `ET`/`OU`, filtres texte (`$x = ba%`)
- **Heuristiques d'optimisation** : tri structurel + estimation de cardinalité
- **Jointures multi-variables** : comparaison par ID JDM, pas par nom
- **Pagination API** : boucle `limit`/`offset` pour récupérer plus de données
- **Cache disque MD5** : évite les requêtes redondantes à l'API
- **Scores et preuves** : chaque résultat porte un score et les clauses qui le justifient
- **Interface glassmorphique** : affichage propre avec AST, warnings, joinStats, pagination

---

## Installation et lancement

### Prérequis
- Node.js v14+
- npm

### Étapes

```bash
# 1. Se placer dans le dossier du projet
cd main

# 2. Installer les dépendances
npm install

# 3. Lancer le serveur
node node.js

# 4. Ouvrir dans le navigateur
# http://localhost:3000
```

### Tests et benchmark (dans un second terminal)

```bash
# Validation du moteur (16 tests)
node verify_logic.js

# Benchmark complet (14 requêtes)
node benchmark.js
```

---

## Syntaxe des requêtes

### Structure d'une clause

```
(SUJET  RELATION  OBJET)
```

- **Variable** : commence par `$` — ex: `$x`, `$y`, `$z`
- **Constante** : mot du graphe JDM — ex: `chat`, `animal`
- **Relation** : nom de relation JDM — ex: `r_isa`, `r_has_part`, `r_can_eat`

### Opérateurs logiques

| Opérateur | Sens | Exemple |
|-----------|------|---------|
| `ET` | Les deux conditions doivent être vraies | `($x r_isa animal) ET ($x r_has_part queue)` |
| `OU` | L'une ou l'autre suffit | `($x r_isa mammifere) OU ($x r_isa oiseau)` |

### Filtre textuel

```
($x = ba%)   → garde les termes commençant par "ba"
($x = %on)   → garde les termes finissant par "on"
($x = ch%)   → garde les termes commençant par "ch"
```

### Parenthèses

```
(($x r_isa mammifere) OU ($x r_isa oiseau)) ET ($x = ch%)
($x r_isa artiste) ET (($x = ba%) OU ($x = Ba%))
```

---

## Exemples de requêtes

| Requête | Description |
|---------|-------------|
| `($x r_isa animal)` | Tous les animaux dans JDM |
| `(chat r_isa $x)` | Toutes les catégories du chat |
| `($x r_isa animal) ET ($x = ch%)` | Animaux commençant par "ch" |
| `($x r_isa artiste) ET (($x = ba%) OU ($x = Ba%))` | Artistes commençant par "ba" |
| `($x r_isa animal) ET ($x r_has_part queue)` | Animaux ayant une queue |
| `($x r_isa animal) ET ($y r_isa animal) ET ($x r_can_eat $y)` | Couples prédateur-proie |
| `(lion r_can_eat $y) ET ($y r_isa animal)` | Proies du lion |
| `(chat r_has_part $y) ET ($y r_isa $z)` | Chaîne de 3 variables |

---

## Architecture

```
main/
├── node.js              ← Serveur Express (point d'entrée)
├── parseur.js           ← Analyse syntaxique → AST
├── heuristiques.js      ← Optimisation de l'ordre d'exécution
├── moteurExecution.js   ← Exécution des plans, jointures, intersections
├── jdmApi.js            ← Appels API JDM + pagination + cache
├── cacheManager.js      ← Cache disque MD5 persistant
├── benchmark.js         ← Tests automatiques + métriques
├── verify_logic.js      ← Tests de validation du moteur
├── relations_wido_optimized.json  ← Dictionnaire des types de relations JDM
└── public/
    ├── index_ter.html   ← Interface utilisateur
    ├── script_ter.js    ← Logique frontend (fetch + affichage)
    └── style_ter.css    ← Design glassmorphique
```

### Flux d'une requête de bout en bout

```
1. Utilisateur saisit la requête dans l'interface
2. Frontend → HTTP GET /recherche?q=...
3. node.js : parseur.js → AST
4. node.js : estimation de cardinalité (appels API légers)
5. node.js : heuristiques.js → plan d'exécution ordonné
6. node.js : moteurExecution.js → appels API + jointures
7. node.js : tri par score, construction de la réponse JSON
8. Frontend : affichage des résultats, AST, warnings, stats
```

---

## Heuristiques

### Complexité structurelle

Le planificateur attribue un score à chaque clause et les exécute du plus faible au plus élevé :

| Score | Type de clause | Exemple |
|------:|----------------|---------|
| 0.5 | Filtre sur variable déjà ancrée | `$x = ch%` (après ancrage) |
| 1 | Ancrage par constante | `($x r_isa animal)` |
| 2 | Vérification (2 variables ancrées) | jointure finale |
| 5 | Exploration ciblée (1 variable ancrée) | `($x r_can_eat $y)` si $x connu |
| 8 | Filtre avant ancrage | `$x = ba%` (avant ancrage) |
| 10 | Jointure sans ancrage | interdit en premier |

### Cardinalité estimée

Pour les clauses ET, le moteur estime la taille de chaque liste (appel API avec `limit=500`) et choisit de commencer par la clause la plus sélective (liste la plus courte).

Exemple : `($x r_isa animal) ET ($x r_has_part queue)`
→ Si `r_has_part queue` donne 105 résultats et `r_isa animal` en donne ≥ 500, le moteur exécutera d'abord `r_has_part queue`.

---

## Jointures et comparaison par ID

Toutes les jointures et intersections utilisent les **IDs JDM** et non les noms.  
Les noms servent uniquement à l'affichage.

**Pourquoi ?** Les noms peuvent avoir des variantes. Les IDs sont uniques et permettent une comparaison en O(1) avec un `Set<id>`.

---

## Pagination API

Le moteur utilise `limit` + `offset` pour récupérer des listes potentiellement grandes :

- `limit = 1000` relations par page
- `maxPages = 5` pages maximum par clause
- `maxTotal = 5000` relations maximum par clause

Si la première page renvoie exactement `limit` résultats, une deuxième page est demandée automatiquement.

---

## Limites connues

1. **API JDM instable** : Le serveur LIRMM peut être lent ou retourner des erreurs 500 temporaires.
2. **Relations peu renseignées** : `r_can_eat` est peu dense dans JDM → la requête à 2 variables peut retourner 0 résultat.
3. **Combinatoire** : Les requêtes à 2-3 variables peuvent générer beaucoup de candidats à tester.
4. **Pas de langage naturel** : WIDO comprend un langage formel strict.
5. **Raffinements non exploités** : La polysémie des mots n'est pas gérée.
6. **Résultats JDM** : La qualité dépend des contributions de la communauté JDM.

---

© 2026 — Projet TER WIDO — Mohamed TEDJINI & Maurice DJOBO
