const axios = require('axios');

const tests = [
    // === Tests fondamentaux ===
    { name: "1. Basic ($x r_isa animal)", q: "($x r_isa animal)", expectStatus: 200 },
    { name: "2. Filter ($x r_isa animal) ET ($x = ba%)", q: "($x r_isa animal) ET ($x = ba%)", expectStatus: 200, minResults: 1 },

    // === Tests booléens imbriqués (Problème 1) ===
    { name: "3. (A OU B) ET C  — (($x r_isa mammifere) OU ($x r_isa oiseau)) ET ($x = ch%)",
      q: "(($x r_isa mammifere) OU ($x r_isa oiseau)) ET ($x = ch%)",
      expectStatus: 200, minResults: 1, validateFn: (r) => r.resultats.every(t => t.$x && t.$x.name.toLowerCase().startsWith('ch')),
      validateMsg: "Tous les résultats doivent commencer par 'ch'" },

    { name: "4. A ET (B OU C)  — ($x r_isa artiste) ET (($x = ba%) OU ($x = Ba%))",
      q: "($x r_isa artiste) ET (($x = ba%) OU ($x = Ba%))",
      expectStatus: 200, minResults: 1,
      validateFn: (r) => r.resultats.every(t => t.$x && t.$x.name.toLowerCase().startsWith('ba')),
      validateMsg: "Tous les résultats doivent commencer par 'ba'" },

    { name: "5. (A OU B) ET C avec relation — (($x r_isa mammifere) OU ($x r_isa oiseau)) ET ($x r_has_part aile)",
      q: "(($x r_isa mammifere) OU ($x r_isa oiseau)) ET ($x r_has_part aile)",
      expectStatus: 200, acceptPartial: true },

    // === Tests direction de relation ===
    { name: "6. Direction check ($x r_isa animal) ET ($x r_has_part queue)",
      q: "($x r_isa animal) ET ($x r_has_part queue)", expectStatus: 200, minResults: 1 },
    { name: "7. Direction check ($x r_isa animal) ET ($x r_has_part poil)",
      q: "($x r_isa animal) ET ($x r_has_part poil)", expectStatus: 200 },
    { name: "8. Reverse (chat r_isa $x)", q: "(chat r_isa $x)", expectStatus: 200, minResults: 1 },

    // === Tests relations instables JDM (Problème 2) ===
    { name: "9. Relation r_carac — ($x r_isa animal) ET ($x r_carac domestique)",
      q: "($x r_isa animal) ET ($x r_carac domestique)",
      expectStatus: 200, acceptPartial: true, noBlast: true },
    { name: "10. Relation r_has_color bleu — ($x r_isa animal) ET ($x r_has_color bleu)",
      q: "($x r_isa animal) ET ($x r_has_color bleu)",
      expectStatus: 200, acceptPartial: true, noBlast: true },
    { name: "11. Relation r_has_color blanc",
      q: "($x r_isa animal) ET ($x r_has_color blanc)",
      expectStatus: 200, acceptPartial: true, noBlast: true },

    // === Test jointure 2 variables ===
    { name: "12. 2-Variable Join ($x r_isa animal) ET ($y r_isa animal) ET ($x r_can_eat $y)",
      q: "($x r_isa animal) ET ($y r_isa animal) ET ($x r_can_eat $y)",
      expectStatus: 200, acceptPartial: true, timeout: 90000 },

    // === Tests d'erreurs attendues ===
    { name: "13. [EXPECT ERROR] Syntax Error ($x r_isa)", q: "($x r_isa)", expectStatus: 500 },
    { name: "14. [EXPECT ERROR] Unknown Relation", q: "($x r_type_inconnu animal)", expectStatus: 500 }
];

async function runTests() {
    console.log("🚀 Starting Comprehensive WIDO Tests (v2)...\n");
    const baseUrl = "http://localhost:3000/recherche";
    let passed = 0, failed = 0;

    for (const t of tests) {
        console.log(`--------------------------------------------------`);
        console.log(`🧪 ${t.name}`);
        console.log(`❓ ${t.q}`);
        const start = Date.now();

        try {
            const resp = await axios.get(baseUrl, { params: { q: t.q }, timeout: t.timeout || 30000 });
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
            const validateOk = !t.validateFn || t.validateFn(data);

            if (minOk && partialOk && noBlastOk && validateOk) {
                const flag = isPartial ? '⚠️ Succès partiel' : '✅ Succès';
                console.log(`${flag} | Résultats: ${resultCount} | ⏱️ ${duration}ms`);
                if (data.resultats && data.resultats.length > 0) {
                    data.resultats.slice(0, 3).forEach((r, i) => {
                        const vars = Object.keys(r).filter(k => !k.startsWith('__'));
                        const label = vars.map(k => `${k}:${r[k].name}`).join(', ');
                        const score = typeof r.__score === 'number' ? r.__score.toFixed(1) : '?';
                        console.log(`   ${i+1}. [${label}] (Score: ${score})`);
                    });
                }
                if (data.warnings && data.warnings.length > 0) {
                    data.warnings.forEach(w => console.log(`   ⚠️ ${w.slice(0, 90)}`));
                }
                passed++;
            } else {
                if (!minOk) console.error(`❌ Résultats insuffisants: ${resultCount} < ${t.minResults}`);
                if (!partialOk) console.error(`❌ Succès partiel non acceptable`);
                if (!noBlastOk) console.error(`❌ Trop de warnings (${(data.warnings||[]).length}) — interface illisible`);
                if (!validateOk) console.error(`❌ Validation: ${t.validateMsg}`);
                if (data.resultats) {
                    data.resultats.slice(0, 3).forEach((r, i) => {
                        const vars = Object.keys(r).filter(k => !k.startsWith('__'));
                        const label = vars.map(k => `${k}:${r[k].name}`).join(', ');
                        console.log(`   ${i+1}. [${label}]`);
                    });
                }
                failed++;
            }
        } catch (err) {
            const status = err.response ? err.response.status : 0;
            const msg = err.response ? (err.response.data.message || JSON.stringify(err.response.data).slice(0, 100)) : err.message;
            if (t.expectStatus && t.expectStatus === status) {
                console.log(`✅ [ERREUR ATTENDUE] HTTP ${status}: ${msg}`);
                passed++;
            } else {
                console.error(`❌ FAILED (HTTP ${status || 'timeout'}): ${msg}`);
                failed++;
            }
        }
    }

    console.log(`\n==================================================`);
    console.log(`📊 RÉSULTATS FINALS: ${passed}/${tests.length} tests réussis`);
    console.log(passed === tests.length ? '🎉 TOUS LES TESTS SONT PASSÉS' : `⚠️ ${failed} test(s) échoué(s)`);
}

runTests();
