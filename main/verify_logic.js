const { creerArbreDeDecision } = require('./parseur.js');
const axios = require('axios');

const queries = [
    // Hors-Piste : Géographie
    "($x r_isa pays) ET ($x r_lieu France)", 
    // Hors-Piste : Cuisine
    "($x r_isa plat) ET ($x r_has_part fromage)", 
    // Hors-Piste : Grammaire
    "($x r_pos Nom) ET ($x r_syn chat)"
];

async function runTests() {
    console.log("🚀 Starting specific verification tests...");
    const baseUrl = "http://localhost:3000/recherche";
    for (const q of queries) {
        console.log(`\n🔍 Testing query: ${q}`);
        try {
            const resp = await axios.get(baseUrl, { params: { q } });
            console.log(`✅ Success! Results: ${resp.data.nb_total}`);
            if (resp.data.resultats && resp.data.resultats.length > 0) {
                console.log(`📝 First result sample:`, JSON.stringify(resp.data.resultats[0], null, 2));
            }
        } catch (err) {
            console.error(`❌ Failed for query: ${q}`);
            console.error(err.response ? err.response.data : err.message);
        }
    }
}
runTests();
