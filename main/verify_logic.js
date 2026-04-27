const { creerArbreDeDecision } = require('./parseur.js');
const axios = require('axios');

// Mock partial node.js logic or rather, require the functions if I can?
// Since node.js is a server script with top-level code, requiring it might start the server.
// Let's create a minimal test runner that interacts with the running server or uses the logic directly.
// To use logic directly, I'd need node.js to export its functions.
// Let's check node.js exports.

// node.js currently doesn't export functions. I'll add them at the end.
// For now, I'll assume I'll add them.

const queries = [
    "($x r_isa animal) ET ($x r_has_color noir)",
    "($x r_isa animal) ET ($y r_isa animal) ET ($x r_can_eat $y)",
    "($x r_isa animal) ET ($x = ba%)"
];

async function runTests() {
    console.log("🚀 Starting verification tests...");
    
    // We expect the server to be running or we can test the logic if exported.
    // Let's try to test via the /recherche endpoint.
    const baseUrl = "http://localhost:3000/recherche";

    for (const q of queries) {
        console.log(`\n🔍 Testing query: ${q}`);
        try {
            const resp = await axios.get(baseUrl, { params: { q } });
            console.log(`✅ Success! Results: ${resp.data.nb_total}`);
            if (resp.data.resultats.length > 0) {
                console.log(`📝 First result sample:`, JSON.stringify(resp.data.resultats[0], null, 2));
            }
        } catch (err) {
            console.error(`❌ Failed for query: ${q}`);
            console.error(err.response ? err.response.data : err.message);
        }
    }
}

// In a real scenario, we'd start the server first.
runTests();
