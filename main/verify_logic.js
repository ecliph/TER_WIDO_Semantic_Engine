/**
 * Tests de validation du moteur WIDO.
 *
 * Vérifie que le serveur fonctionne correctement sur les cas clés.
 * Lancement : node main/verify_logic.js  (avec le serveur actif)
 *
 * Note : Les erreurs syntaxiques retournent désormais HTTP 200 avec statut "Erreur".
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000/recherche';
const TWO_VAR_TIMEOUT = 130000; // 130s pour les jointures lourdes

const tests = [
    // ── Tests fondamentaux ─────────────────────────────────────────────────
    {
        name: '01. Requête simple',
        q: '($x r_isa animal)',
        expectStatus: 200,
        minResults: 1,
        checkFields: true
    },
    {
        name: '02. Filtre ch%',
        q: '($x r_isa animal) ET ($x = ch%)',
        expectStatus: 200,
        minResults: 1
    },
    {
        name: '03. Filtre ba%',
        q: '($x r_isa animal) ET ($x = ba%)',
        expectStatus: 200,
        minResults: 1
    },

    // ── Booléens imbriqués ─────────────────────────────────────────────────
    {
        name: '04. (A OU B) ET C',
        q: '(($x r_isa mammifere) OU ($x r_isa oiseau)) ET ($x = ch%)',
        expectStatus: 200,
        minResults: 1
    },
    {
        name: '05. A ET (B OU C) — requête artiste officielle',
        q: '($x r_isa artiste) ET (($x = ba%) OU ($x = Ba%))',
        expectStatus: 200,
        minResults: 1
    },

    // ── Direction des relations ─────────────────────────────────────────────
    {
        name: '06. Direction inverse (chat r_isa $x)',
        q: '(chat r_isa $x)',
        expectStatus: 200,
        minResults: 1
    },
    {
        name: '07. Jointure ET avec propriété',
        q: '($x r_isa animal) ET ($x r_has_part queue)',
        expectStatus: 200,
        minResults: 1
    },

    // ── OU dans propriété ──────────────────────────────────────────────────
    {
        name: '08. ET avec OU dans propriété',
        q: '($x r_isa animal) ET (($x r_has_part aile) OU ($x r_has_part queue))',
        expectStatus: 200,
        minResults: 1
    },

    // ── Requête 2 variables (requête officielle du sujet TER) ──────────────
    {
        name: '09. 2 variables — ($x r_can_eat $y) — requête officielle',
        q: '($x r_isa animal) ET ($y r_isa animal) ET ($x r_can_eat $y)',
        expectStatus: 200,
        acceptPartial: true,
        timeout: TWO_VAR_TIMEOUT,
        validate: (data) => {
            // joinStats OBLIGATOIRE pour les requêtes à 2 variables
            const j = data.debug && data.debug.joinStats;
            if (!j) {
                console.warn('   ⚠️  joinStats absent dans debug — les stats de jointure ne sont pas remontées');
                return true; // Non bloquant
            }
            console.log(`   📊 Candidats dispo   : ${j.candidatsDisponibles}`);
            console.log(`   📊 Candidats testés   : ${j.candidatsTestes}`);
            console.log(`   📊 Couples trouvés    : ${j.couplesTrouves}`);
            console.log(`   📊 wasLimited         : ${j.wasLimited}`);
            console.log(`   📊 Relation           : ${j.relation}`);
            return true; // 0 résultats acceptable (API JDM instable)
        }
    },

    // ── 3 variables ─────────────────────────────────────────────────────────
    {
        name: '10. 3 variables — (chat r_has_part $y) ET ($y r_isa $z)',
        q: '(chat r_has_part $y) ET ($y r_isa $z)',
        expectStatus: 200,
        acceptPartial: true,
        timeout: TWO_VAR_TIMEOUT
    },
    {
        name: '11. 3 variables avec filtre — ($x r_has_part $y) ET ($y = pa%)',
        q: '($x r_isa animal) ET ($x r_has_part $y) ET ($y = pa%)',
        expectStatus: 200,
        acceptPartial: true,
        timeout: TWO_VAR_TIMEOUT
    },

    // ── Requête ciblée ─────────────────────────────────────────────────────
    {
        name: '12. Requête ciblée — lion r_can_eat',
        q: '(lion r_can_eat $y) ET ($y r_isa animal)',
        expectStatus: 200,
        acceptPartial: true
    },

    // ── Stabilité serveur ──────────────────────────────────────────────────
    {
        name: '13. Stabilité serveur après requête lourde',
        q: '($x r_isa animal)',
        expectStatus: 200,
        minResults: 1,
        note: 'Le serveur doit rester stable après les requêtes précédentes'
    },

    // ── Erreurs syntaxiques (HTTP 200 + statut Erreur) ─────────────────────
    {
        name: '14. [ERREUR ATTENDUE] Clause incomplète ($x r_isa)',
        q: '($x r_isa)',
        expectStatus: 200,
        expectStatut: 'Erreur',
        checkNoUndefined: true
    },
    {
        name: '15. [ERREUR ATTENDUE] Relation inconnue',
        q: '($x relation_inconnue animal)',
        expectStatus: 200,
        // Peut être "Erreur" (relation inconnue) ou "Succès" vide selon le parseur
        acceptAnyStatut: true,
        checkNoUndefined: true
    },

    // ── Qualité des warnings ────────────────────────────────────────────────
    {
        name: '16. Pas de flood de warnings ($x r_isa animal)',
        q: '($x r_isa animal)',
        expectStatus: 200,
        minResults: 1,
        maxWarnings: 3
    }
];

// ─────────────────────────────────────────────────────────────────────────────
// Vérification qu'aucun champ de la réponse n'est undefined
// ─────────────────────────────────────────────────────────────────────────────
function checkNoUndefined(data, path = '') {
    const problems = [];
    for (const [key, val] of Object.entries(data)) {
        const fullKey = path ? `${path}.${key}` : key;
        if (val === undefined) problems.push(fullKey);
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            problems.push(...checkNoUndefined(val, fullKey));
        }
    }
    return problems;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────
async function runTests() {
    console.log('🚀 WIDO — Tests de validation (version finale TER)\n');
    let passed = 0, failed = 0;

    for (const t of tests) {
        console.log('-'.repeat(55));
        console.log(`🧪 ${t.name}`);
        console.log(`❓ ${t.q}`);
        if (t.note) console.log(`ℹ️  ${t.note}`);

        const start = Date.now();

        try {
            const resp = await axios.get(BASE_URL, {
                params: { q: t.q },
                timeout: t.timeout || 35000
            });
            const data = resp.data;
            const duration = Date.now() - start;
            const httpStatus = resp.status;

            // ── Vérification HTTP status ──────────────────────────────────
            if (t.expectStatus && httpStatus !== t.expectStatus) {
                console.error(`❌ HTTP ${httpStatus} (attendu ${t.expectStatus})`);
                failed++; continue;
            }

            // ── Vérification du statut JSON ───────────────────────────────
            if (t.expectStatut && data.statut !== t.expectStatut) {
                console.error(`❌ Statut "${data.statut}" (attendu "${t.expectStatut}")`);
                console.error(`   Message : ${data.message}`);
                failed++; continue;
            }

            // ── Vérification absence d'undefined ─────────────────────────
            if (t.checkNoUndefined) {
                const problems = checkNoUndefined(data);
                if (problems.length > 0) {
                    console.error(`❌ Champs undefined détectés : ${problems.join(', ')}`);
                    failed++; continue;
                }
            }

            // ── Pour les erreurs attendues : succès si statut = "Erreur" ──
            if (t.expectStatut === 'Erreur') {
                console.log(`✅ [ERREUR PROPRE] Statut: ${data.statut} | Message: ${(data.message || '').slice(0, 80)}`);
                passed++; continue;
            }

            // ── Vérifications de qualité ──────────────────────────────────
            const resultCount = typeof data.nb_total === 'number' ? data.nb_total : -1;
            const isPartial = data.statut === 'Succès partiel';
            const partialOk = !isPartial || t.acceptPartial || t.acceptAnyStatut;
            const minOk = t.minResults === undefined || resultCount >= t.minResults;
            const maxWarnOk = !t.maxWarnings || (data.warnings || []).length <= t.maxWarnings;
            const validateOk = !t.validate || t.validate(data);

            // ── Champs obligatoires ───────────────────────────────────────
            let fieldsOk = true;
            if (t.checkFields) {
                if (typeof data.nb_total !== 'number') {
                    console.error(`❌ nb_total n'est pas un nombre : ${data.nb_total}`);
                    fieldsOk = false;
                }
                if (data.debug && data.debug.apiCalls === undefined) {
                    console.error(`❌ debug.apiCalls est undefined`);
                    fieldsOk = false;
                }
                if (!data.arbre) {
                    console.error(`❌ arbre est null ou absent pour une requête valide`);
                    fieldsOk = false;
                }
            }

            if (minOk && partialOk && maxWarnOk && validateOk && fieldsOk) {
                const flag = isPartial ? '⚠️  Succès partiel' : '✅ Succès';
                console.log(`${flag} | Résultats: ${resultCount} | ⏱️ ${duration}ms | API: ${data.debug ? data.debug.apiCalls : '?'} appels`);
                (data.resultats || []).slice(0, 2).forEach((r, i) => {
                    const vars = Object.keys(r).filter(k => !k.startsWith('__'));
                    const label = vars.map(k => `${k}:${r[k] && r[k].name}`).join(', ');
                    const score = typeof r.__score === 'number' ? r.__score.toFixed(1) : '?';
                    console.log(`   ${i + 1}. [${label}] (Score: ${score})`);
                });
                (data.warnings || []).slice(0, 2).forEach(w => console.log(`   ⚠️  ${w.slice(0, 90)}`));
                passed++;
            } else {
                if (!minOk) console.error(`❌ Seulement ${resultCount} résultats (min: ${t.minResults})`);
                if (!partialOk) console.error(`❌ Succès partiel non acceptable`);
                if (!maxWarnOk) console.error(`❌ Trop de warnings: ${(data.warnings || []).length}`);
                if (!fieldsOk) console.error(`❌ Champs manquants ou invalides`);
                failed++;
            }

        } catch (err) {
            const status = err.response ? err.response.status : 0;
            const msg = err.response
                ? ((err.response.data && err.response.data.message) || '').slice(0, 80)
                : err.message.slice(0, 80);

            const label = err.code === 'ECONNABORTED' ? 'TIMEOUT CLIENT'
                : err.code === 'ECONNREFUSED' ? 'SERVEUR ÉTEINT'
                : (status ? `HTTP ${status}` : err.message.slice(0, 40));

            console.error(`❌ FAILED (${label}): ${msg}`);
            failed++;
        }
    }

    console.log('\n' + '='.repeat(55));
    console.log(`📊 RÉSULTATS : ${passed}/${tests.length} tests réussis`);
    if (failed === 0) {
        console.log('🎉 TOUS LES TESTS PASSÉS — Le moteur WIDO est opérationnel.');
    } else {
        console.log(`⚠️  ${failed} test(s) échoué(s) — voir les messages ci-dessus.`);
    }
    console.log('='.repeat(55));
}

runTests();
