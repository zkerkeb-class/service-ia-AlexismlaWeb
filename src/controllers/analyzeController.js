const express = require("express");
const router = express.Router();

const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Multer : pour accepter une image envoyée en form-data
const upload = multer({ dest: "uploads/" });

router.post("/", upload.single("image"), async (req, res) => {
  const imagePath = req.file.path;
  const ext = path.extname(req.file.originalname);

  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString("base64");

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `
Tu es une IA experte en mode. À partir de l’image fournie, analyse les vêtements visibles et retourne uniquement un tableau JSON, un objet par vêtement détecté.

Chaque objet doit contenir :
- "type": type du vêtement (ex : t-shirt, jean, veste, chaussures...)
- "color": couleur dominante (en français)
- "style": style approximatif (casual, streetwear, chic, sport, etc.)
- "brand": marque détectée (ou "inconnue")
- "suggestedBrands": tableau de 3 marques similaires

⚠️ Important :
- Si plusieurs vêtements sont présents, détecte-les tous
- Ne retourne AUCUN texte hors JSON
- Réponse uniquement au format tableau JSON

Exemple :

[
  {
    "type": "t-shirt",
    "color": "blanc",
    "style": "casual",
    "brand": "nike",
    "suggestedBrands": ["nike", "adidas", "puma"]
  },
  {
    "type": "jean",
    "color": "bleu",
    "style": "streetwear",
    "brand": "inconnue",
    "suggestedBrands": ["zara", "levi's", "bershka"]
  }
]
`
              ,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/${ext.slice(1)};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 500,
    });

    const gptResponse = response.choices[0].message.content.trim();

    let json;
    try {
      json = JSON.parse(gptResponse);
    } catch (error) {
      const match = gptResponse.match(/\{[\s\S]*\}/);
      if (match) {
        json = JSON.parse(match[0]);
      } else {
        throw new Error("Impossible d'extraire un JSON propre");
      }
    }

    res.status(200).json(json);
  } catch (error) {
    console.error("Erreur analyse IA:", error);
    res.status(500).json({ error: "Échec d’analyse", details: error.message });
  } finally {
    fs.unlinkSync(imagePath); // Supprime le fichier temporaire
  }
});

module.exports = router;
