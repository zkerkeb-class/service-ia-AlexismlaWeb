const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
const ImageKit = require("imagekit");
const axios = require("axios");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

router.post("/", upload.single("image"), async (req, res) => {
  const imagePath = req.file.path;
  const originalName = req.file.originalname;
  const userId = req.body.userId;

  if (!userId) {
    return res.status(400).json({ error: "userId est requis." });
  }

  try {
    // Upload image sur ImageKit
    const imageBuffer = fs.readFileSync(imagePath);
    const uploadResponse = await imagekit.upload({
      file: imageBuffer,
      fileName: originalName,
      folder: "/dressing/"
    });
    const uploadedImageUrl = uploadResponse.url;

    // Upload fichier à OpenAI
    const fileUpload = await openai.files.create({
      file: fs.createReadStream(imagePath),
      purpose: "assistants",
    });

    // Créer un thread
    const thread = await openai.beta.threads.create();

    // Ajouter le message avec l'image
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: [
        {
          type: "text",
          text: `
          Analyse cette image et retourne UNIQUEMENT un tableau JSON :
          [
            {
              "type": "t-shirt",
              "color": "noir",
              "style": "streetwear",
              "brand": "nike",
              "suggestedBrands": ["nike", "adidas", "puma"]
            }
          ]
          Aucun texte ou explication, que du JSON propre.
          `,
        },
        {
          type: "image_file",
          image_file: { file_id: fileUpload.id },
        },
      ],
    });

    // Lancer l'assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    // Attendre que le traitement soit terminé
    let completedRun;
    while (true) {
      completedRun = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      if (completedRun.status === "completed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Récupérer la réponse
    const messages = await openai.beta.threads.messages.list(thread.id);
    const gptResponse = messages.data[0].content[0].text.value.trim();
    console.log("Réponse GPT brute:", gptResponse);

    let clothesArray;
    try {
      clothesArray = JSON.parse(gptResponse);
    } catch (error) {
      const match = gptResponse.match(/\[[\s\S]*\]/);
      if (match) {
        clothesArray = JSON.parse(match[0]);
      } else {
        throw new Error("Impossible d'extraire un JSON propre");
      }
    }

    // Sauvegarder chaque vêtement en BDD
    const results = [];

    for (const clothing of clothesArray) {
      try {
        const saveResponse = await axios.post("http://localhost:4001/api/clothing", {
          userId,
          type: clothing.type,
          color: clothing.color,
          style: clothing.style,
          brand: clothing.brand,
          suggestedBrands: clothing.suggestedBrands.join(", "),
          imageUrl: uploadedImageUrl,
          season: "all" // ➔ ajouter cette ligne 🚀
        });
          
        results.push(saveResponse.data);
      } catch (error) {
        console.error("Erreur enregistrement vêtement :", error.response?.data || error.message);
      }
    }

    // ✅ ENFIN ici la réponse finale propre
    res.status(201).json({ message: "Vêtements analysés et enregistrés", clothes: results });

  } catch (error) {
    console.error("Erreur analyse IA:", error);
    res.status(500).json({ error: "Échec d’analyse", details: error.message });
  } finally {
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
  }
});

module.exports = router;
