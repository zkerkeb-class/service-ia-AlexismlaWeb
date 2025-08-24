const express = require("express");
const router = express.Router();
const { OpenAI } = require("openai");
const axios = require("axios");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DB_SERVICE_URL = "http://bdd-service:4001";

// POST /api/recommendation
router.post("/", async (req, res) => {
  const { userId, style, weather } = req.body;
  const token = req.headers.authorization;

  if (!userId || !weather?.condition || !weather?.temperature) {
    return res.status(400).json({ error: "Champs requis : userId, weather.condition, weather.temperature" });
  }

  try {
    // Récupère l'utilisateur enrichi
    const userRes = await axios.get(`${DB_SERVICE_URL}/api/users/${userId}`);
    const user = userRes.data;

    // Récupère les préférences utilisateur
    let preferences = null;
    try {
      const prefRes = await axios.get(`${DB_SERVICE_URL}/api/preferences`, {
        headers: { Authorization: token },
      });
      preferences = prefRes.data;
    } catch (e) {
      // Pas de préférences trouvées, ce n'est pas bloquant
      preferences = null;
    }

    // Gestion des tokens IA (inchangé)
    const now = new Date();
    const lastReset = new Date(user.lastTokenReset);
    const daysSinceReset = (now - lastReset) / (1000 * 60 * 60 * 24);
    if (user.aiTokens === 0 && daysSinceReset >= 7) {
      await axios.put(`${DB_SERVICE_URL}/api/users/${userId}/reset-tokens`, {
        aiTokens: 1,
        lastTokenReset: now.toISOString(),
      });
      user.aiTokens = 1;
    }
    if (user.aiTokens <= 0 && !user.isPremium) {
      return res.json({
        success: false,
        error: "Plus de crédits IA disponibles. Revenez plus tard ou achetez un pack.",
        recommendation: null,
        selectedItemIds: [],
      });
    }
    await axios.put(`${DB_SERVICE_URL}/api/users/${userId}/consume-token`);

    // Récupère les vêtements
    const clothingResponse = await axios.get(
      `${DB_SERVICE_URL}/api/clothing?userId=${userId}`,
      { headers: { Authorization: token } }
    );
    const clothingItems = clothingResponse.data;
    if (!Array.isArray(clothingItems) || clothingItems.length === 0) {
      return res.status(404).json({ error: "Aucun vêtement trouvé pour cet utilisateur." });
    }
    const formattedInventory = clothingItems.map(item =>
      `ID: ${item.id}, Type: ${item.type}, Marque: ${item.brand}, Couleur: ${item.color}, Style: ${item.style || "N/A"}, Saison: ${item.season || "N/A"}`
    ).join("\n");

    // Génération du prompt enrichi
    const prompt = `
Voici le profil utilisateur :
- Genre : ${user.genre || "non renseigné"}
- Âge : ${user.age || "non renseigné"}
- Taille : ${user.taille ? user.taille + " cm" : "non renseigné"}
- Poids : ${user.poids ? user.poids + " kg" : "non renseigné"}
- Morphologie : ${user.morphologie || "non renseigné"}
- Styles préférés : ${(user.stylesPreferes || []).join(", ") || "non renseigné"}
- Couleurs/motifs favoris : ${(user.couleursMotifs || []).join(", ") || "non renseigné"}
- Restrictions (matières, vêtements à éviter) : ${user.restrictions || "aucune"}
- Ville : ${user.ville || "non renseigné"}
${preferences ? `- Préférences :\n  - Couleurs favorites : ${(preferences.favoriteColors || []).join(", ")}\n  - Couleurs à éviter : ${(preferences.avoidColors || []).join(", ")}\n  - Styles favoris : ${(preferences.favoriteStyles || []).join(", ")}\n  - Types à éviter : ${(preferences.avoidTypes || []).join(", ")}` : ""}

# Inventaire du Dressing :
${formattedInventory}

# Météo :
Condition : ${weather.condition}
Température : ${weather.temperature}°C

Ta mission :
Propose une tenue complète adaptée à ce profil et à la météo, sans jamais inclure deux vêtements de la même catégorie (ex : pas deux pantalons). Sélectionne 3 à 4 vêtements maximum. Pour chaque vêtement, précise la catégorie, la couleur/motif, et explique brièvement pourquoi ce choix est pertinent pour l’utilisateur et la météo.

# Format attendu (en JSON) :
{
  "recommendation": "Description de la tenue et justification",
  "selectedItemIds": ["id1", "id2", "id3", "id4"]
}

Ne fournis rien d'autre que cet objet JSON.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0].message.content;
    console.log("✅ Réponse GPT:", aiResponse);

    try {
      const parsed = JSON.parse(aiResponse);
      if (!parsed.recommendation || !Array.isArray(parsed.selectedItemIds)) {
        throw new Error("Format de réponse invalide");
      }
      // Vérification : pas deux vêtements de la même catégorie
      const selectedItems = clothingItems.filter(item => parsed.selectedItemIds.includes(item.id));
      const categories = new Set();
      for (const item of selectedItems) {
        if (categories.has(item.type)) {
          return res.status(400).json({ error: "La tenue contient deux vêtements de la même catégorie." });
        }
        categories.add(item.type);
      }
      return res.status(200).json(parsed);
    } catch (err) {
      console.error("❌ JSON invalide depuis OpenAI:", aiResponse);
      return res.status(500).json({ error: "Réponse OpenAI non parsable", raw: aiResponse });
    }

  } catch (error) {
    console.error("❌ Erreur recommandation :", error.response?.data || error);
    return res.status(500).json({ error: "Erreur interne", details: error.message });
  }
});

module.exports = router;
