const axios = require('axios');

async function tester() {
    const requete = "($x r_isa animal)";
    console.log("===================================");
    console.log("🚀 Lancement du test via Terminal");
    console.log("🔍 Requête envoyée :", requete);
    console.log("===================================");
    
    try {
        const reponse = await axios.get(`http://localhost:3000/recherche?q=${encodeURIComponent(requete)}`);
        console.log("✅ RÉPONSE DU SERVEUR :\n");
        // Affiche proprement le JSON dans le terminal avec de la couleur
        console.dir(reponse.data, { depth: null, colors: true });
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            console.error("❌ ERREUR : Le serveur n'est pas allumé !");
            console.error("-> Vous devez d'abord lancer 'node main/node.js' dans un autre terminal.");
        } else {
            console.error("❌ Erreur inattendue :", err.message);
        }
    }
}

tester();
