const express = require("express");
const router = express.Router();
const { OpenAI } = require("openai");
const axios = require("axios");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DB_SERVICE_URL = process.env.DB_SERVICE_URL || "http://localhost:4001";

// POST /api/recommendation
router.post("/", async (req, res) => {
  const { userId, style, weather } = req.body;
  const token = req.headers.authorization;

  if (!userId || !style || !weather?.condition || !weather?.temperature) {
    return res.status(400).json({ error: "Champs requis : userId, style, weather.condition, weather.temperature" });
  }

  try {
    // 🔐 Vérification de l'utilisateur dans DB service
    const userRes = await axios.get(`${DB_SERVICE_URL}/api/users/${userId}`);
    const user = userRes.data;

    // ⏱ Vérifie s’il faut recharger un token gratuit
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

    // 🚫 Bloque si plus de tokens
    if (user.aiTokens <= 0 && !user.isPremium) {
      return res.status(403).json({
        error: "Plus de crédits IA disponibles. Revenez plus tard ou achetez un pack.",
      });
    }

    // 🔽 Décrémente le token
    await axios.put(`${DB_SERVICE_URL}/api/users/${userId}/consume-token`);

    // ✅ Récupère les vêtements
    const clothingResponse = await axios.get(
      `${DB_SERVICE_URL}/api/clothing?userId=${userId}`,
      {
        headers: {
          Authorization: token,
        },
      }
    );

    const clothingItems = clothingResponse.data;
    if (!Array.isArray(clothingItems) || clothingItems.length === 0) {
      return res.status(404).json({ error: "Aucun vêtement trouvé pour cet utilisateur." });
    }

    const formattedInventory = clothingItems.map(item =>
      `ID: ${item.id}, Type: ${item.type}, Marque: ${item.brand}, Couleur: ${item.color}, Style: ${item.style || "N/A"}, Saison: ${item.season || "N/A"}`
    ).join("\n");

    const prompt = `
Voici une liste de vêtements avec leurs identifiants. En fonction de la météo et du style préféré, sélectionne une tenue cohérente.

# Inventaire du Dressing :
${formattedInventory}

# Météo :
Condition : ${weather.condition}
Température : ${weather.temperature}°C

# Style du Client :
${style}

# Format attendu (en JSON) :
{
  "recommendation": "Description de la tenue et justification",
  "selectedItemIds": ["id1", "id2", "id3"]
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
