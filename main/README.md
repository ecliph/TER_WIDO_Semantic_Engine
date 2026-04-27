# WIDO : Moteur Sémantique de Haute Performance (JDM v0)

WIDO est un moteur de recherche sémantique robuste conçu pour interroger dynamiquement le graphe de connaissances **JeuxDeMots (JDM)**. Il offre une interface moderne et un moteur d'exécution capable de résoudre des requêtes complexes utilisant des variables, des opérateurs logiques et des jointures multi-variables.

## 🚀 Caractéristiques

- **Consommation JDM v0** : Intégration complète avec l'API v0 (OpenAPI).
- **Heuristiques Intelligentes** : Priorisation des clauses les plus contraintes pour minimiser les appels réseau.
- **Jointures Multi-Variables** : Support des requêtes comme `($x r_can_eat $y)` via des stratégies d'exploration et de vérification.
- **Cache Intelligent** : Système de cache local persistant (MD5) pour accélérer les requêtes récurrentes.
- **Design Glassmorphique** : Interface utilisateur premium, responsive et interactive.

## 🛠️ Installation et Lancement

### Prérequis
- [Node.js](https://nodejs.org/) (v14+ recommandé)
- npm (installé avec Node.js)

### Étapes
1. **Installation des dépendances** :
   ```bash
   cd main
   npm install
   ```

2. **Lancement du serveur** :
   ```bash
   node node.js
   ```

3. **Accès** :
   Ouvrez votre navigateur sur `http://localhost:3000`.

## 🧠 Guide de Syntaxe des Requêtes

Le moteur WIDO utilise une syntaxe inspirée de la logique des prédicats. Vous pouvez combiner plusieurs clauses pour filtrer les résultats.

### 1. Structure de base d'une clause
Une clause de relation se définit par trois éléments :
`([Variable ou Constant] [Relation] [Variable ou Constant])`

- **Variable** : Commence par `$`, par exemple `$x`. Elle sera résolue en une liste de termes correspondants.
- **Constant** : Un mot précis dans la base JDM (ex: `chat`, `animal`).
- **Relation** : Le nom de la relation JDM (ex: `r_isa`, `r_syn`, `r_has_part`).

### 2. Opérateurs Logiques
- **ET** : Intersection des résultats. Les deux clauses doivent être vraies.
  *Ex: `($x r_isa animal) ET ($x r_has_color noir)`*
- **OU** : Union des résultats. Au moins l'une des deux clauses doit être vraie.
  *Ex: `($x r_isa oiseau) OU ($x r_isa mammifere)`*

### 3. Filtres de texte
Vous pouvez filtrer le nom des résultats en utilisant l'opérateur `=`.
- `$x = ba%` : Garde les termes commençant par "ba".
- `$x = %on` : Garde les termes finissant par "on".

### 4. Parenthèses
Utilisez les parenthèses pour grouper vos clauses et définir des priorités complexes.
*Ex: `(($x r_isa pays) ET ($x r_lieu Europe)) OU ($x r_isa ville)`*

---
© 2026 - Projet TER WIDO - Mohamed TEDJINI & Maurice DJOBO
