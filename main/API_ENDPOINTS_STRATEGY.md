# Strategy: JDM v0 API Endpoints

This document explains the technical choices for interacting with the JeuxDeMots (JDM) API v0.

## Endpoints Tree

### 1. Node Resolution
- **Endpoint**: `/v0/node_by_name/{name}`
- **Usage**: Mandatory first step to convert a user-pasted string into a canonical node.
- **Why**: JDM can have multiple IDs for slight variations, but the canonical name is the safest entry point.

### 2. Relations Retrieval
- **By Name (Preferred)**: `/v0/relations/{direction}/{name}`
- **By ID**: `/v0/relations/{direction}/id/{id}`
- **Direction**:
    - `from`: Outgoing relations (Subject -> Object). Use for `(chat r_isa $x)`.
    - `to`: Incoming relations (Object <- Subject). Use for `($x r_isa animal)`.
- **Query Params**:
    - `types_ids`: Filter by relation type ID (e.g., 6 for `r_isa`).
    - `min_weight`: Minimum relevance score (default 10 in our engine).

### 3. Relation Verification
- **Endpoint**: `/v0/relations/from/id/{idSource}?types_ids={idRel}`
- **Strategy**: To check if `($x r_can_eat $y)` where both are known, we fetch all outgoing relations of `$x` and check if `$y` is in the list.

## Error Handling & Limits

| Error Code | Meaning | Engine Action |
|------------|---------|---------------|
| 400 | Bad Request | Log details and skip current clause. |
| 404 | Not Found | Treat as empty results (legitimate case). |
| 500 | Server Error| API Instability. Retry once, then mark as "Success Partiel". |
| Timeout | Slow Resp | Skip clause if > 15s to avoid blocking. |

## Choices Made
1. **Canonical Names**: We always resolve to canonical names to avoid ID-based inconsistency observed in JDM v0.
2. **MD5 Caching**: All URL calls are cached by MD5 hash to stay within API limits and improve speed.
3. **Weight Sorting**: Results are sorted by `w` (weight) at the API level and preserved in our engine.
