const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

const serveurWeb = express();
console.log("🛠️ Initialisation du serveur...");
serveurWeb.use(cors());
serveurWeb.use(express.static(path.join(__dirname, 'public')));

// --- CONFIGURATION DU CACHE ---
const DOSSIER_CACHE = path.join(__dirname, 'cache');
fs.ensureDirSync(DOSSIER_CACHE);

// Importation de tes modules TER
const relationsData = require('./relations_wido_optimized.json');
const { creerArbreDeDecision } = require('./parseur.js');

// --- LOGIQUE MÉTIER ---

let RELATION_TYPES_MAP = new Map();

/**
 * Initialise le dictionnaire des relations depuis l'API JDM
 */
async function initialiserRelations() {
    try {
        console.log("📥 Chargement des types de relations JDM...");
        const response = await axios.get('https://jdm-api.demo.lirmm.fr/v0/relations_types');
        if (response.data && Array.isArray(response.data)) {
            response.data.forEach(rel => {
                RELATION_TYPES_MAP.set(rel.name, rel.id);
            });
            console.log(`✅ ${RELATION_TYPES_MAP.size} types de relations chargés.`);
        }
    } catch (err) {
        console.error("❌ Erreur critique lors du chargement des types de relations :", err.response ? err.response.data : err.message);
        // Fallback sur le fichier local si l'API est KO
        if (relationsData && relationsData.relations) {
            relationsData.relations.forEach(rel => {
                RELATION_TYPES_MAP.set(rel.name, rel.id);
            });
            console.warn("⚠️ Fallback sur le dictionnaire local réussi.");
        }
    }
}

function obtenirIdRelation(nomRelation) {
    if (RELATION_TYPES_MAP.has(nomRelation)) {
        return RELATION_TYPES_MAP.get(nomRelation);
    }
    // Fallback dynamique : si c'est déjà un ID numeric
    if (!isNaN(nomRelation)) return parseInt(nomRelation);
    return 6; // r_isa par défaut
}

function calculerJoin(liste1, liste2) {
    // Mathématiquement, si on fait "A ET B" et que A est introuvable (vide), 
    // alors l'ensemble est obligatoirement vide.
    if (liste1.length === 0 || liste2.length === 0) return [];

    // Trouver les variables partagées (ex: $x)
    const cles1 = Object.keys(liste1[0]);
    const cles2 = Object.keys(liste2[0]);
    const variablesCommunes = cles1.filter(cle => cles2.includes(cle));

    const resultat = [];

    if (variablesCommunes.length > 0) {
        // JOINTURE LOGIQUE (INNER JOIN) : on croise uniquement là où c'est identique
        for (const t1 of liste1) {
            for (const t2 of liste2) {
                let match = true;
                for (const vCom of variablesCommunes) {
                    if (t1[vCom].id !== t2[vCom].id) {
                        match = false;
                        break;
                    }
                }
                // Si les IDs de la variable commune matchent, on fusionne les deux tuples
                if (match) {
                    resultat.push({ ...t1, ...t2 });
                }
            }
        }
    } else {
        // AUCUNE VARIABLE COMMUNE : Produit cartésien (on associe tout avec tout)
        for (const t1 of liste1) {
            for (const t2 of liste2) {
                resultat.push({ ...t1, ...t2 });
            }
        }
    }
    return resultat;
}

function calculerUnionTuple(liste1, liste2) {
    // UNION LOGIQUE (OU) : Fusion avec suppression intelligente des doublons
    const vu = new Set();
    const resultat = [];
    
    function dedupliquer(tupleObj) {
        // On crée une empreinte unique basé sur l'ID de chaque chose dans le tuple
        const empreinte = Object.keys(tupleObj).sort().map(k => `${k}:${tupleObj[k].id}`).join('|');
        if (!vu.has(empreinte)) {
            vu.add(empreinte);
            resultat.push(tupleObj);
        }
    }

    liste1.forEach(dedupliquer);
    liste2.forEach(dedupliquer);
    return resultat;
}

/**
 * Résout un nom de nœud en ID via JDM v0
 */
async function resoudreNodeId(nomRel) {
    const url = `https://jdm-api.demo.lirmm.fr/v0/node_by_name/${encodeURIComponent(nomRel.toLowerCase().trim())}`;
    try {
        const resp = await axios.get(url);
        if (resp.data && resp.data.id) {
            return { id: resp.data.id, name: resp.data.name };
        }
        throw new Error(`Nœud "${nomRel}" introuvable sur JDM (v0/node_by_name)`);
    } catch (err) {
        if (err.response && err.response.status === 404) {
            throw new Error(`Nœud "${nomRel}" inexistant (404)`);
        }
        throw err;
    }
}

/**
 * Récupère les données depuis JDM-API avec filtrage de pertinence et q_constraint
 */
async function fetchJDM(mot, relId, direction = 'from') {
    const motPropre = mot.toLowerCase().trim();

    // 1. Résolution Canonique (Point de vigilance 1)
    let nodeInfo;
    try {
        nodeInfo = await resoudreNodeId(motPropre);
    } catch (err) {
        console.error(`❌ Échec résolution canonique pour "${motPropre}":`, err.message);
        throw err; // On propage l'erreur explicite
    }

    const idNode = nodeInfo.id;
    const nameNode = nodeInfo.name;

    // 2. Récupération intelligente du q_constraint depuis le gros JSON
    const infoRel = relationsData.relations.find(r => r.id === relId);
    const poidsMinRequis = (infoRel && infoRel.q_constraint && infoRel.q_constraint.min) 
                           ? infoRel.q_constraint.min 
                           : 10;

    // Utilisation du NOM canonique (JDM v0 relations ID semble buggé/incomplet)
    const urlJDM = `https://jdm-api.demo.lirmm.fr/v0/relations/${direction}/${encodeURIComponent(nameNode)}?types_ids=${relId}&min_weight=${poidsMinRequis}`;

    console.log(`\n🔗 URL JDM appelée : ${urlJDM} (ID résolu: ${idNode})`);
    console.log(`🧭 Direction : ${direction} | ⚖️ Poids minimum ciblé : ${poidsMinRequis}`);

    const hash = crypto.createHash('md5').update(urlJDM).digest('hex');
    const cheminFichierCache = path.join(DOSSIER_CACHE, `${hash}.json`);

    // --- VÉRIFICATION DU CACHE AVANT L'API (Obligatoire) ---
    if (await fs.pathExists(cheminFichierCache)) {
        console.log(`📦 [CACHE] Récupération de sauvegarde existante pour : ${nameNode} (${direction})`);
        return await fs.readJson(cheminFichierCache);
    }

    try {
        console.log(`🌐 [API] Appel API Officielle en cours : ${motPropre} (Rel: ${relId}, Direction: ${direction})`);
        const reponse = await axios.get(urlJDM, { timeout: 15000 });
        const rawData = reponse.data;

        const nodesMap = {};
        if (rawData.nodes) {
            rawData.nodes.forEach(n => nodesMap[n.id] = n.name);
        }

        const resultatsFinal = (rawData.relations || [])
            .filter(rel => rel.w >= poidsMinRequis)
            .sort((a, b) => b.w - a.w)
            .map(rel => {
                const nodeId = direction === 'to' ? rel.node1 : rel.node2;
                const nodeName = nodesMap[nodeId] || `ID: ${nodeId}`;
                return {
                    id: nodeId,
                    name: nodeName,
                    poids: rel.w
                };
            });

        const output = { resultats: resultatsFinal };

        // Écriture du cache
        if (resultatsFinal.length > 0) {
            await fs.writeJson(cheminFichierCache, output);
        }
        return output;

    } catch (err) {
        if (err.response && err.response.status === 400) {
            console.error(`⚠️ Erreur 400 (Bad Request) pour "${motPropre}". Détails :`, err.response.data);
        } else {
            console.error(`❌ Erreur critique JDM pour "${motPropre}":`, err.message);
        }
        throw new Error(`Interrogation API impossible pour ${motPropre} (${err.message})`);
    }
}

/**
 * Exécute l'arbre de décision en retournant des TUPLES pour la jointure SQL-Like
 */
async function executerArbre(noeud, contexte = {}) {
    if (noeud.type === 'CLAUSE_RELATION') {
        const idRel = obtenirIdRelation(noeud.relation);
        const varEstVariable = noeud.variable && noeud.variable.startsWith('$');
        const cibleEstVariable = noeud.cible && noeud.cible.startsWith('$');

        // --- CAS : VARIABLE -> VARIABLE (Verif ou Exploration) ---
        if (varEstVariable && cibleEstVariable) {
            const varName = noeud.variable;
            const cibleName = noeud.cible;

            // 1. VERIFICATION : Si les deux sont déjà ancrées (Bind)
            if (contexte[varName] && contexte[cibleName]) {
                console.log(`🧠 [HEURISTIQUE] Vérification de relation entre ${varName} et ${cibleName}`);
                const results = [];
                for (const valVar of contexte[varName]) {
                    for (const valCible of contexte[cibleName]) {
                        const check = await verifierRelation(valVar.id, idRel, valCible.id);
                        if (check) {
                            results.push({ [varName]: valVar, [cibleName]: valCible });
                        }
                    }
                }
                return results;
            }

            // 2. EXPLORATION : Si une seule est ancrée
            if (contexte[varName] || contexte[cibleName]) {
                const ancrage = contexte[varName] ? { name: varName, data: contexte[varName], dir: 'from' } 
                                                  : { name: cibleName, data: contexte[cibleName], dir: 'to' };
                const cible = contexte[varName] ? cibleName : varName;
                
                console.log(`🧠 [HEURISTIQUE] Exploration de ${cible} via ancrage ${ancrage.name}`);
                const results = [];
                for (const valAncre of ancrage.data) {
                    // Pour éviter de saturer l'API, on utilise fetchJDM avec l'ID déjà résolu
                    // Mais fetchJDM attend un mot (nom). On va passer l'ID si fetchJDM le supporte ou modifier fetchJDM.
                    // Pour l'instant, utilisons le nom car fetchJDM fait une résolution canonique.
                    const data = await fetchJDM(valAncre.name, idRel, ancrage.dir);
                    (data.resultats || []).forEach(rel => {
                        results.push({
                            [ancrage.name]: valAncre,
                            [cible]: { id: rel.id, name: rel.name, w: rel.poids }
                        });
                    });
                }
                return results;
            }

            throw new Error(`Recherche variable-variable impossible sans ancrage préalable pour ${varName} ou ${cibleName}`);
        }

        let direction, mot, varName;
        if (varEstVariable) {
            direction = 'to';
            mot = noeud.cible;
            varName = noeud.variable;
        } else {
            direction = 'from';
            mot = noeud.variable;
            varName = noeud.cible;
        }

        const data = await fetchJDM(mot, idRel, direction);
        return (data.resultats || []).map(rel => ({
            [varName]: { id: rel.id, name: rel.name, w: rel.poids }
        }));
    }

    if (noeud.type === 'CLAUSE_FILTRE') {
        const varName = noeud.variable;
        const pattern = noeud.filtre; // ex: ba%

        if (!contexte[varName]) return [];

        const regex = new RegExp('^' + pattern.replace(/%/g, '.*') + '$', 'i');
        return contexte[varName]
            .filter(item => regex.test(item.name))
            .map(item => ({ [varName]: item }));
    }

    if (noeud.operateur === 'ET') {
        // --- HEURISTIQUE : Trier les branches pour exécuter les plus contraintes d'abord ---
        // Les clauses avec des constantes sont prioritaires.
        const branches = [noeud.gauche, noeud.droite];
        branches.sort((a, b) => evaluerComplexite(a) - evaluerComplexite(b));

        let resultats = null;
        for (const branche of branches) {
            const currentRes = await executerArbre(branche, resultatsToContexte(resultats));
            resultats = resultats ? calculerJoin(resultats, currentRes) : currentRes;
            if (resultats.length === 0) return [];
        }
        return resultats;
    }

    if (noeud.operateur === 'OU') {
        const [resG, resD] = await Promise.all([
            executerArbre(noeud.gauche, contexte),
            executerArbre(noeud.droite, contexte)
        ]);
        return calculerUnionTuple(resG, resD);
    }

    return [];
}

/**
 * Vérifie si une relation existe entre deux IDs
 */
async function verifierRelation(idSource, idRel, idCible) {
    try {
        // Utilisation de l'endpoint filtré pour vérification rapide
        const url = `https://jdm-api.demo.lirmm.fr/v0/relations/from/id/${idSource}?types_ids=${idRel}`;
        const hash = crypto.createHash('md5').update(url + "_check").digest('hex');
        const cachePath = path.join(DOSSIER_CACHE, `${hash}.json`);

        let data;
        if (await fs.pathExists(cachePath)) {
            data = await fs.readJson(cachePath);
        } else {
            const resp = await axios.get(url);
            data = resp.data;
            await fs.writeJson(cachePath, data);
        }

        return (data.relations || []).some(r => r.node2 === idCible);
    } catch (e) {
        return false;
    }
}

function evaluerComplexite(noeud) {
    if (noeud.type === 'CLAUSE_RELATION') {
        const varEstVariable = noeud.variable && noeud.variable.startsWith('$');
        const cibleEstVariable = noeud.cible && noeud.cible.startsWith('$');
        if (varEstVariable && cibleEstVariable) return 5; // Jointure (plus complexe)
        return 1; // Un ancrage constant (récupération initiale)
    }
    if (noeud.type === 'CLAUSE_FILTRE') {
        // Un filtre doit s'exécuter APRES qu'une variable soit ancrée
        // On lui donne une complexité légèrement supérieure à 1 pour qu'il soit trié après une relation simple
        return 1.5; 
    }
    return 2; // Noeud logique (ET/OU)
}

function resultatsToContexte(resultats) {
    if (!resultats || resultats.length === 0) return {};
    const contexte = {};
    resultats.forEach(res => {
        Object.keys(res).forEach(varName => {
            if (!contexte[varName]) contexte[varName] = [];
            contexte[varName].push(res[varName]);
        });
    });
    return contexte;
}

// --- ROUTES ---

serveurWeb.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index_ter.html'));
});

serveurWeb.get('/recherche', async (req, res) => {
    const question = req.query.q;
    console.log("\n🔍 Analyse de la requête :", question);

    try {
        const arbreLogique = creerArbreDeDecision(question);
        const resultatsFinaux = await executerArbre(arbreLogique);

        res.json({
            statut: "Succès",
            nb_total: resultatsFinaux.length,
            resultats: resultatsFinaux,
            arbre: arbreLogique // Pour affichage de l'AST dans l'interface
        });
    } catch (err) {
        console.error("❌ Erreur serveur :", err.message);
        res.status(500).json({ erreur: "Erreur moteur", details: err.message });
    }
});

// --- DÉMARRAGE ---
const PORT = 3000;
initialiserRelations().then(() => {
    serveurWeb.listen(PORT, () => {
        console.log(`
        =============================================
        🚀 MOTEUR WIDO OPÉRATIONNEL (V3.1)
        📍 URL : http://localhost:${PORT}
        📦 Cache : MD5 Activé
        🧠 Heuristique : Constantes Prioritaires
        =============================================
        `);
    });
});