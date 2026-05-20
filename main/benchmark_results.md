# Benchmark WIDO — Résultats

_Généré le 2026-05-20 23:16:37_

## Tableau récapitulatif

| # | Requête | Statut | Résultats | Temps (ms) | Appels API | Pagination | Remarque |
|---|---------|--------|----------:|----------:|----------:|-----------|----------|
| 1 | `($x r_isa animal)` | Succès | 1000 | 21 | 0 | 5p/5000 | Affichage limité aux 1000 meilleurs résultats (tri |
| 2 | `($x r_isa animal) ET ($x = ch%)` | Succès | 133 | 9 | 0 | 5p/5000 | Pagination API utilisée : 5000 relations récupérée |
| 3 | `($x r_isa animal) ET ($x r_has_part queue)` | Succès | 1000 | 15 | 0 | 10p/10000 | Affichage limité aux 1000 meilleurs résultats (tri |
| 4 | `(($x r_isa mammifere) OU ($x r_isa oiseau)) ET ...` | Succès | 86 | 11 | 0 | 6p/5000 | Pagination API utilisée : 5000 relations récupérée |
| 5 | `($x r_isa artiste) ET (($x = ba%) OU ($x = Ba%))` | Succès | 37 | 6 | 0 | 5p/5000 | Pagination API utilisée : 5000 relations récupérée |
| 6 | `($x r_isa animal) ET (($x r_has_part aile) OU (...` | Succès | 1000 | 16 | 0 | 15p/15000 | Affichage limité aux 1000 meilleurs résultats (tri |
| 7 | `($x r_isa animal) ET ($y r_isa animal) ET ($x r...` | Succès | 0 | 57 | 0 | 510p/18500 | Join: 0 couples, 500 testés |
| 8 | `(chat r_isa $x)` | Succès | 350 | 3 | 0 | Non | - |
| 9 | `(chat r_has_part $x)` | Succès | 303 | 2 | 0 | Non | - |
| 10 | `(chat r_has_part $y) ET ($y r_isa $z)` | Succès | 1000 | 10 | 0 | Non | Join: 1000 couples, 33 testés |
| 11 | `($x r_isa animal) ET ($x r_has_part $y) ET ($y ...` | Succès | 47 | 8 | 0 | 20p/6057 | Join: 1000 couples, 15 testés |
| 12 | `(lion r_can_eat $y) ET ($y r_isa animal)` | Succès | 4 | 3 | 0 | 6p/5015 | Pagination API utilisée : 5015 relations récupérée |
| 13 | `($x r_isa)` | Erreur | 0 | 1 | 0 | Non | Syntaxe invalide — la requête n'a pas pu être anal |
| 14 | `($x relation_inconnue animal)` | Erreur | 0 | 2 | 0 | Non | Erreur interne du moteur : Relation inconnue : "re |

## Détail des jointures à deux variables

### Requête #7 : `($x r_isa animal) ET ($y r_isa animal) ET ($x r_can_eat $y)`

- **Relation** : r_can_eat
- **Variable ancrée** : $x
- **Variable découverte** : $y
- **Candidats disponibles** : 10000
- **Candidats testés** : 500
- **Couples trouvés** : 0
- **Exploration limitée** : Oui
- **Arrêt anticipé** : Non
- **Comparaison par ID** : Oui

### Requête #10 : `(chat r_has_part $y) ET ($y r_isa $z)`

- **Relation** : r_isa
- **Variable ancrée** : $y
- **Variable découverte** : $z
- **Candidats disponibles** : 303
- **Candidats testés** : 33
- **Couples trouvés** : 1000
- **Exploration limitée** : Non
- **Arrêt anticipé** : Oui
- **Comparaison par ID** : Oui

### Requête #11 : `($x r_isa animal) ET ($x r_has_part $y) ET ($y = pa%)`

- **Relation** : r_has_part
- **Variable ancrée** : $x
- **Variable découverte** : $y
- **Candidats disponibles** : 5000
- **Candidats testés** : 15
- **Couples trouvés** : 1000
- **Exploration limitée** : Oui
- **Arrêt anticipé** : Oui
- **Comparaison par ID** : Oui


## Exemples de plans d'exécution (heuristiques)

### Requête #2 : `($x r_isa animal) ET ($x = ch%)`

| Rang | Clause | Complexité | Cardinalité | Raison |
|-----:|--------|----------:|------------:|--------|
| 1 | `($x r_isa animal)` | 1 | >=500 | Ancrage initial par constante, cardinalité estimée : >=500 |
| 2 | `($x = ch%)` | 0.5 | ? | Filtre local sur variable déjà ancrée (très rapide) |

### Requête #3 : `($x r_isa animal) ET ($x r_has_part queue)`

| Rang | Clause | Complexité | Cardinalité | Raison |
|-----:|--------|----------:|------------:|--------|
| 1 | `($x r_isa animal)` | 1 | >=500 | Ancrage initial par constante, cardinalité estimée : >=500 |
| 2 | `($x r_has_part queue)` | 1 | >=500 | Ancrage initial par constante, cardinalité estimée : >=500 |

### Requête #4 : `(($x r_isa mammifere) OU ($x r_isa oiseau)) ET ($x = ch%)`

| Rang | Clause | Complexité | Cardinalité | Raison |
|-----:|--------|----------:|------------:|--------|
| 1 | `NOEUD_LOGIQUE` | 3 | ? | Complexité 3 |
| 2 | `($x = ch%)` | 8 | ? | Filtre en attente d'ancrage de la variable |


## Résumé

- **Requêtes réussies** : 14/14
- **Durée moyenne** : 12 ms
- **Appels API totaux** : 0
- **Pagination utilisée** : 9 requête(s)

_Note : Les requêtes à deux variables (7, 10) peuvent retourner 0 résultats selon la disponibilité de la relation dans JDM._
