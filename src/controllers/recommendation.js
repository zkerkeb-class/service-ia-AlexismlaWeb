const express = require("express");
const router = express.Router();
const { OpenAI } = require("openai");
const axios = require("axios");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// POST /api/recommendation
router.post("/", async (req, res) => {
  const { userId, style, weather } = req.body;
  const token = req.headers.authorization;

  if (!userId || !style || !weather?.condition || !weather?.temperature) {
    return res.status(400).json({ error: "Champs requis : userId, style, weather.condition, weather.temperature" });
  }

  try {
    // 🔐 Debug : vérifier si le token est bien reçu
    console.log("🔐 Auth header reçu:", token);

    // ✅ Récupérer le dressing de l'utilisateur avec le token
    const clothingResponse = await axios.get(
      `http://192.168.1.42:4001/api/clothing?userId=${userId}`,
      {
        headers: {
          Authorization: token, // Transmet le token vers clothing API
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
    console.error("❌ Erreur recommandation :", error);
    return res.status(500).json({ error: "Erreur interne", details: error.message });
  }
});

module.exports = router;
