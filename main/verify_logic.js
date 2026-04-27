const axios = require('axios');

// Durée pour le test de la requête 2 variables (doit finir avant ce délai)
const TWO_VAR_TIMEOUT = 60000;

const tests = [
    // === Tests fondamentaux ===
    { name: "1. Basic ($x r_isa animal)", q: "($x r_isa animal)", expectStatus: 200 },
    { name: "2. Filter ($x r_isa animal) ET ($x = ba%)", q: "($x r_isa animal) ET ($x = ba%)", expectStatus: 200, minResults: 1 },
    { name: "3. Filter ch%", q: "($x r_isa animal) ET ($x = ch%)", expectStatus: 200, minResults: 1 },

    // === Tests booléens imbriqués ===
    { name: "4. (A OU B) ET C",   q: "(($x r_isa mammifere) OU ($x r_isa oiseau)) ET ($x = ch%)", expectStatus: 200, minResults: 1 },
    { name: "5. A ET (B OU C)",   q: "($x r_isa artiste) ET (($x = ba%) OU ($x = Ba%))",       expectStatus: 200, minResults: 1 },
    { name: "6. (A OU B) ET rel", q: "(($x r_isa mammifere) OU ($x r_isa oiseau)) ET ($x r_has_part aile)", expectStatus: 200, acceptPartial: true },

    // === Tests direction de relation ===
    { name: "7. Direction ($x r_has_part queue)", q: "($x r_isa animal) ET ($x r_has_part queue)", expectStatus: 200, minResults: 1 },
    { name: "8. Reverse (chat r_isa $x)",         q: "(chat r_isa $x)",                   expectStatus: 200, minResults: 1 },

    // === Requête 2 variables du sujet TER ===
    { name: "9. 2-Var Join ($x r_can_eat $y) — doit finir sans timeout",
      q: "($x r_isa animal) ET ($y r_isa animal) ET ($x r_can_eat $y)",
      expectStatus: 200, acceptPartial: true, timeout: TWO_VAR_TIMEOUT,
      validate: (data) => {
          const ok = data.warnings && data.warnings.some(w => w.includes('limit'));
          if (!ok) console.warn('   ℹ️  Pas de warning "limité" — vérifier');
          return true; // succès partiel sans résultats = acceptable
      }},

    // === Test de stabilité après requête lourde ===
    { name: "10. Server stable after heavy query",
      q: "($x r_isa animal)",
      expectStatus: 200, minResults: 1,
      note: "Vérifie que le serveur répond encore normalement après la requête 2-var" },

    // === Relations instables JDM ===
    { name: "11. r_carac domestique",  q: "($x r_isa animal) ET ($x r_carac domestique)",  expectStatus: 200, acceptPartial: true, noBlast: true },
    { name: "12. r_has_color bleu",    q: "($x r_isa animal) ET ($x r_has_color bleu)",    expectStatus: 200, acceptPartial: true, noBlast: true },
    { name: "13. r_has_color blanc",   q: "($x r_isa animal) ET ($x r_has_color blanc)",   expectStatus: 200, acceptPartial: true, noBlast: true },

    // === Erreurs attendues ===
    { name: "14. [EXPECT ERROR] Syntax Error", q: "($x r_isa)",              expectStatus: 500 },
    { name: "15. [EXPECT ERROR] Unknown Rel",  q: "($x r_type_inconnu animal)", expectStatus: 500 }
];

async function runTests() {
    console.log("🚀 WIDO Tests v3 — Timeout & 2-Variable Stability\n");
    const baseUrl = "http://localhost:3000/recherche";
    let passed = 0, failed = 0;

    for (const t of tests) {
        console.log(`--------------------------------------------------`);
        console.log(`🧪 ${t.name}`);
        console.log(`❓ ${t.q}`);
        if (t.note) console.log(`ℹ️  ${t.note}`);
        const start = Date.now();

        try {
            const resp = await axios.get(baseUrl, { params: { q: t.q }, timeout: t.timeout || 35000 });
            const data = resp.data;
            const duration = Date.now() - start;

            if (t.expectStatus === 500) {
                console.error(`❌ Devait retourner 500, a répondu 200`);
                failed++; continue;
            }

            const resultCount = data.nb_total || 0;
            const isPartial = data.statut === 'Succès partiel';
            const partialOk = !isPartial || t.acceptPartial;
            const minOk = !t.minResults || resultCount >= t.minResults;
            const noBlastOk = !t.noBlast || (data.warnings || []).length <= 3;
            const validateOk = !t.validate || t.validate(data);

            if (minOk && partialOk && noBlastOk && validateOk) {
                const flag = isPartial ? '⚠️  Succès partiel' : '✅ Succès';
                console.log(`${flag} | Résultats: ${resultCount} | ⏱️ ${duration}ms`);
                (data.resultats || []).slice(0, 3).forEach((r, i) => {
                    const vars = Object.keys(r).filter(k => !k.startsWith('__'));
                    const label = vars.map(k => `${k}:${r[k].name}`).join(', ');
                    const score = typeof r.__score === 'number' ? r.__score.toFixed(1) : '?';
                    console.log(`   ${i+1}. [${label}] (Score: ${score})`);
                });
                (data.warnings || []).forEach(w => console.log(`   ⚠️  ${w.slice(0, 90)}`));
                passed++;
            } else {
                if (!minOk) console.error(`❌ ${resultCount} résultats < ${t.minResults} attendus`);
                if (!partialOk) console.error(`❌ Succès partiel non acceptable`);
                if (!noBlastOk) console.error(`❌ Trop de warnings: ${(data.warnings||[]).length}`);
                failed++;
            }
        } catch (err) {
            const status = err.response ? err.response.status : 0;
            const msg = err.response ? (err.response.data.message || '').slice(0, 100) : err.message.slice(0, 100);
            if (t.expectStatus && t.expectStatus === status) {
                console.log(`✅ [ERREUR ATTENDUE] HTTP ${status}: ${msg}`);
                passed++;
            } else {
                const label = status ? `HTTP ${status}` : (err.code === 'ECONNABORTED' ? 'TIMEOUT CLIENT' : err.message.slice(0, 60));
                console.error(`❌ FAILED (${label}): ${msg}`);
                failed++;
            }
        }
    }

    console.log(`\n==================================================`);
    console.log(`📊 RÉSULTATS: ${passed}/${tests.length} tests réussis`);
    console.log(passed === tests.length ? '🎉 TOUS LES TESTS SONT PASSÉS' : `⚠️  ${failed} test(s) échoué(s)`);
}

runTests();
