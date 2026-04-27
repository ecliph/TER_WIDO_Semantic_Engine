const axios = require('axios');

async function testerRequetes() {
    // Une requête simple avec une variable à compléter (To)
    const req1 = "($x r_isa animal)";
    // Une requête simple avec une variable à compléter (From)
    const req2 = "(chat r_isa $x)";
    // Une requête avancée testant la Jointure mathématique (ET)
    const req3 = "($x r_isa animal) ET (chat r_can_eat $x)";

    console.log("==========================================");
    console.log("🧪 DIAGNOSTIC WIDO VIA TERMINAL (BACKEND)");
    console.log("==========================================\n");

    try {
        console.log("🔹 TEST 1 :", req1);
        let res = await axios.get(`http://localhost:3000/recherche?q=${encodeURIComponent(req1)}`);
        console.log(`✅ Succès ! ${res.data.nb_total} animaux trouvés.`);
        console.log("Exemple du premier :", res.data.resultats[0]);
        console.log("------------------------------------------");

        console.log("🔹 TEST 2 :", req2);
        res = await axios.get(`http://localhost:3000/recherche?q=${encodeURIComponent(req2)}`);
        console.log(`✅ Succès ! Le chat est un : ${res.data.nb_total} choses.`);
        console.log("Exemple :", res.data.resultats[0]);
        console.log("------------------------------------------");

        console.log("🔹 TEST 3 (La VRAIE Jointure 'ET') :", req3);
        res = await axios.get(`http://localhost:3000/recherche?q=${encodeURIComponent(req3)}`);
        console.log(`✅ Succès ! J'ai croisé les animaux ET les choses mangées par le chat.`);
        console.log(`🔍 Résultat de la jointure (${res.data.nb_total} trouvés) :`);
        console.dir(res.data.resultats, { depth: null, colors: true });
        
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            console.error("❌ ERREUR FATALE : Le serveur Node.js n'est pas allumé !");
        } else if (err.response) {
            console.error("❌ ERREUR SERVEUR :", err.response.data);
        } else {
            console.error("❌ ERREUR INCONNUE :", err.message);
        }
    }
}

testerRequetes();
