const axios = require('axios');

const tests = [
    // Tests fondamentaux
    { name: "1. Basic ($x r_isa animal)", q: "($x r_isa animal)", expectStatus: 200 },
    { name: "2. Filter ($x r_isa animal) ET ($x = ba%)", q: "($x r_isa animal) ET ($x = ba%)", expectStatus: 200, minResults: 1 },
    { name: "3. Nested OU ($x r_isa artiste) ET (($x = ba%) OU ($x = Ba%))", q: "($x r_isa artiste) ET (($x = ba%) OU ($x = Ba%))", expectStatus: 200 },
    { name: "4. Reverse (chat r_isa $x)", q: "(chat r_isa $x)", expectStatus: 200, minResults: 1 },
    { name: "5. Relation r_has_part (chat r_has_part $x)", q: "(chat r_has_part $x)", expectStatus: 200, minResults: 1 },

    // Tests du sens de relation (Fix 1)
    { name: "A. Direction check ($x r_isa animal) ET ($x r_has_part queue)", q: "($x r_isa animal) ET ($x r_has_part queue)", expectStatus: 200, minResults: 1, note: "Sens: $x -> r_has_part -> queue" },
    { name: "B. Direction check ($x r_isa animal) ET ($x r_has_part poil)", q: "($x r_isa animal) ET ($x r_has_part poil)", expectStatus: 200, note: "Sens: $x -> r_has_part -> poil" },

    // Test jointure 2 variables (Fix 2 — anticiper un Succès partiel avec warning)
    { name: "6. 2-Variable Join ($x r_isa animal) ET ($y r_isa animal) ET ($x r_can_eat $y)",
      q: "($x r_isa animal) ET ($y r_isa animal) ET ($x r_can_eat $y)",
      expectStatus: 200,
      acceptPartial: true,   // Succès partiel avec warning = OK
      timeout: 90000 },

    // Tests de validation d'erreurs
    { name: "7. [EXPECT ERROR] Syntax Error ($x r_isa)", q: "($x r_isa)", expectStatus: 500 },
    { name: "8. [EXPECT ERROR] Unknown Relation ($x r_type_inconnu animal)", q: "($x r_type_inconnu animal)", expectStatus: 500 }
];

async function runTests() {
    console.log("🚀 Starting Comprehensive WIDO Tests...\n");
    const baseUrl = "http://localhost:3000/recherche";
    let passed = 0, failed = 0;

    for (const t of tests) {
        console.log(`--------------------------------------------------`);
        console.log(`🧪 ${t.name}`);
        console.log(`❓ Query: ${t.q}`);
        if (t.note) console.log(`📌 Note: ${t.note}`);

        const start = Date.now();
        try {
            const resp = await axios.get(baseUrl, { params: { q: t.q }, timeout: t.timeout || 30000 });
            const data = resp.data;
            const duration = Date.now() - start;

            if (t.expectStatus === 500) {
                console.error(`❌ INATTENDU: Devait retourner 500, a répondu 200`);
                failed++; continue;
            }

            const resultCount = data.nb_total || 0;
            const isPartial = data.statut === 'Succès partiel';
            const partialOk = !isPartial || t.acceptPartial;
            const minOk = !t.minResults || resultCount >= t.minResults;

            if (minOk && partialOk) {
                const flag = isPartial ? '⚠️ Succès partiel' : '✅ Succès';
                console.log(`${flag} | Count: ${resultCount} | ⏱️ ${duration}ms`);
                if (data.resultats && data.resultats.length > 0) {
                    data.resultats.slice(0, 3).forEach((r, i) => {
                        const label = Object.keys(r).filter(k => !k.startsWith('__')).map(k => `${k}:${r[k].name}`).join(', ');
                        const score = typeof r.__score === 'number' ? r.__score.toFixed(2) : r.__score;
                        console.log(`   ${i+1}. [${label}] (Score: ${score})`);
                    });
                }
                if (data.warnings && data.warnings.length > 0) {
                    data.warnings.forEach(w => console.log(`   ⚠️ ${w.length > 100 ? w.slice(0, 100) + '…' : w}`));
                }
                passed++;
            } else {
                if (!minOk) console.error(`❌ Résultats insuffisants: ${resultCount} < ${t.minResults}`);
                if (!partialOk) console.error(`❌ Succès partiel non acceptable pour ce test`);
                failed++;
            }
        } catch (err) {
            const status = err.response ? err.response.status : 0;
            const msg = err.response ? (err.response.data.message || JSON.stringify(err.response.data)) : err.message;
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
