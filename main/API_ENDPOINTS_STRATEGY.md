# Stratégie des Endpoints — API JeuxDeMots v0

Ce document décrit les endpoints de l'API JDM utilisés par le moteur WIDO, les choix techniques, et la correspondance entre une requête WIDO et l'endpoint API appelé.

API de référence : `https://jdm-api.demo.lirmm.fr`
Schéma OpenAPI : `https://jdm-api.demo.lirmm.fr/schema`

---

## 1. Endpoints disponibles

### 1.1 `GET /v0/node_by_name/{node_name}`
**Rôle** : Convertit un nom de mot en nœud JDM (retourne son `id` et son `name` canonique).  
**Utilisé pour** : Résoudre une constante textuelle avant les appels de relations.  
**Exemple** : `/v0/node_by_name/chat` → `{ id: 39642, name: "chat" }`

### 1.2 `GET /v0/node_by_id/{node_id}`
**Rôle** : Retrouve un nœud à partir de son identifiant numérique.  
**Utilisé pour** : Affichage du nom d'un nœud quand on n'a que l'ID.

### 1.3 `GET /v0/refinements/{node_name}`
**Rôle** : Récupère les différents sens (raffinements) d'un mot polysémique.  
**Utilisé pour** : Gestion future de la polysémie (ex : "chat" = animal ou messagerie).  
**Statut dans WIDO** : Non exploité dans la version actuelle.

### 1.4 `GET /v0/nodes_types`
**Rôle** : Liste les types de nœuds JDM (mot, expression, syntagme...).  
**Utilisé pour** : Documentation et débogage uniquement.

### 1.5 `GET /v0/relations/from/{node_name}`
**Rôle** : Récupère les relations qui **partent** d'un nœud connu.  
**Direction** : `node_name → $x`  
**Utilisé pour** : Clause WIDO de type `(chat r_isa $x)`.  
**Exemple** : `/v0/relations/from/chat?types_ids=6` → toutes les catégories de "chat"

### 1.6 `GET /v0/relations/to/{node_name}`
**Rôle** : Récupère les relations qui **arrivent vers** un nœud connu.  
**Direction** : `$x → node_name`  
**Utilisé pour** : Clause WIDO de type `($x r_isa animal)`.  
**Exemple** : `/v0/relations/to/animal?types_ids=6` → tous les animaux

### 1.7 `GET /v0/relations/from_by_id/{node_id}`
**Rôle** : Identique à `/from/{name}` mais utilise l'ID numérique.  
**Avantage** : Plus fiable (contourne les ambiguïtés de casse ou d'accents).  
**Utilisé pour** : Jointures Var→Var quand l'ID de la variable ancrée est disponible.

### 1.8 `GET /v0/relations/to_by_id/{node_id}`
**Rôle** : Identique à `/to/{name}` mais utilise l'ID numérique.  
**Utilisé pour** : Jointures Var→Var en direction inverse.

### 1.9 `GET /v0/relations/from/{node1_name}/to/{node2_name}`
**Rôle** : Vérifie ou récupère une relation entre deux nœuds identifiés par leurs noms.  
**Utilisé pour** : Clause constante-constante comme `(chat r_isa animal)`.

### 1.10 `GET /v0/relations/from_by_id/{id1}/to_by_id/{id2}`
**Rôle** : Vérifie une relation entre deux nœuds identifiés par leurs IDs.  
**C'est l'endpoint le plus précis et le plus fiable** pour vérifier un couple exact.  
**Utilisé pour** : `checkRelation(idSource, relationId, idCible)` dans `jdmApi.js`.

### 1.11 `GET /v0/relations/by_type_id/{type_id}`
**Rôle** : Récupère toutes les relations d'un type donné dans toute la base.  
**Attention** : Peut renvoyer des dizaines de milliers de résultats — à n'utiliser qu'avec pagination.  
**Utilisé pour** : Exploration globale (non activé dans WIDO pour protéger l'API).

---

## 2. Paramètres importants

| Paramètre | Rôle | Valeur par défaut WIDO |
|-----------|------|----------------------|
| `types_ids` | Filtre sur l'ID de la relation (ex: 6 pour r_isa) | Requis |
| `min_weight` | Poids minimal de la relation (qualité/pertinence) | 10 |
| `limit` | Nombre de relations par page | 1000 |
| `offset` | Position de départ dans la liste (pagination) | 0 |
| `relation_fields` | Champs retournés pour les relations | Défaut API |
| `node_fields` | Champs retournés pour les nœuds | Défaut API |
| `without_nodes` | Si `true`, la réponse n'inclut pas les infos des nœuds | Non utilisé |

---

## 3. Pagination `limit` + `offset`

L'API JDM supporte une pagination native par `limit` et `offset`.

**Principe** :
```
Page 1 : limit=1000, offset=0    → résultats 1 à 1000
Page 2 : limit=1000, offset=1000 → résultats 1001 à 2000
Page 3 : limit=1000, offset=2000 → résultats 2001 à 3000
```

**Arrêt** : Si la page renvoie moins de `limit` résultats, il n'y a plus de données.

**Limites de sécurité dans WIDO** :
- `limit = 1000` par page
- `maxPages = 5` (5000 relations max par clause)
- `maxTotal = 5000`

---

## 4. Correspondance Requête WIDO → Endpoint API

| Requête WIDO | Endpoint API utilisé |
|--------------|---------------------|
| `($x r_isa animal)` | `GET /v0/relations/to/animal?types_ids={r_isa_id}` |
| `(chat r_isa $x)` | `GET /v0/relations/from/chat?types_ids={r_isa_id}` |
| `(chat r_isa animal)` | `GET /v0/relations/from/chat/to/animal?types_ids={r_isa_id}` |
| `($x r_can_eat $y)` avec $x connu | `GET /v0/relations/from_by_id/{x_id}?types_ids={r_can_eat_id}` |
| `($x r_can_eat $y)` avec $y connu | `GET /v0/relations/to_by_id/{y_id}?types_ids={r_can_eat_id}` |
| Vérification couple (x_id, y_id) | `GET /v0/relations/from_by_id/{x_id}/to_by_id/{y_id}?types_ids={rel_id}` |
| Estimation cardinalité d'une clause | `GET /v0/relations/to/{constante}?types_ids={rel_id}&limit=500` |

---

## 5. Choix techniques justifiés

### Pourquoi comparer par ID et non par nom ?
Les IDs JDM sont uniques et stables. Les noms peuvent avoir des variantes de casse, des accents, ou être partagés par plusieurs nœuds. Utiliser les IDs garantit des jointures exactes et des performances en O(1) avec un `Set`.

### Pourquoi utiliser `from_by_id` dans les jointures ?
Lors d'une jointure Var→Var, on a déjà l'ID de la variable ancrée. L'endpoint `from_by_id` est donc plus direct et évite une résolution intermédiaire par nom.

### Pourquoi limiter la pagination ?
Une requête sans limite pourrait récupérer des milliers de pages et surcharger l'API du LIRMM. Les limites `maxPages=5` et `maxTotal=5000` sont un compromis entre exhaustivité et performance.

---

## 6. Gestion des erreurs

| Code | Signification | Action du moteur |
|------|--------------|-----------------|
| 200 | Succès | Traitement normal |
| 404 | Nœud ou relation introuvable | Résultat vide (cas légitime) |
| 400 | Requête mal formée | Log + ignore la clause |
| 500 | Erreur serveur JDM | Retry 1× puis marque en erreur |
| Timeout | API lente (> 15s) | Skip la clause, warning |
