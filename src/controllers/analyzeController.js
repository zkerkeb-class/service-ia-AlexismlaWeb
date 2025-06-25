const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
const ImageKit = require("imagekit");
const Replicate = require("replicate");
const axios = require("axios");

require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error("Format de fichier non autorisé"));
    }
    cb(null, Date.now() + ext);
  },
});

const upload = multer({ storage });

router.post("/", upload.single("image"), async (req, res) => {
  const imagePath = req.file.path;
  const originalName = path.parse(req.file.originalname).name;

  try {
    // 1. Envoyer l'image à OpenAI pour analyse
    const fileUpload = await openai.files.create({
      file: fs.createReadStream(imagePath),
      purpose: "assistants",
    });

    // 2. Créer un thread de conversation
    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: [
        {
          type: "image_file",
          image_file: { file_id: fileUpload.id },
        },
      ],
    });

    // 3. Lancer l’analyse
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    let completedRun;
    while (true) {
      completedRun = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      if (completedRun.status === "completed") break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 4. Récupérer la réponse
    const messages = await openai.beta.threads.messages.list(thread.id);
    const gptResponse = messages.data[0].content[0].text.value.trim();
    console.log("Réponse GPT brute:", gptResponse);

    // 5. Vérifier si l’analyse est valide avant de continuer
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

    // 6. Supprimer le fond via Replicate
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;

    const replicateResponse = await replicate.run(
      "851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc",
      { input: { image: base64Image } }
    );

    const cleanedImageUrl = replicateResponse;
    if (!cleanedImageUrl) {
      return res.status(400).json({ error: "Erreur de suppression du fond" });
    }

    console.log("✅ Image fond supprimé créée :", cleanedImageUrl);

    // 7. Télécharger l’image nettoyée et l’uploader sur ImageKit
    const finalImageBuffer = (await axios.get(cleanedImageUrl, { responseType: "arraybuffer" })).data;

    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);

    const finalUpload = await imagekit.upload({
      file: finalImageBuffer,
      fileName: originalName + ".jpg",
      folder: "/dressing/",
    });

    const finalImageUrl = finalUpload.url;
    console.log("✅ Image finale uploadée sur ImageKit :", finalImageUrl);

    // 8. Sauvegarder les vêtements analysés
    const results = [];
    for (const clothing of clothesArray) {
      try {
        const saveResponse = await axios.post("http://192.168.1.42:4001/api/clothing", {
          userId: req.body.userId,
          type: clothing.type,
          color: clothing.color,
          style: clothing.style,
          brand: clothing.brand,
          suggestedBrands: clothing.suggestedBrands.join(", "),
          imageUrl: finalImageUrl,
          season: clothing.season || "all",
        });
        results.push(saveResponse.data);
      } catch (error) {
        console.error("Erreur enregistrement vêtement :", error.response?.data || error.message);
      }
    }

    res.status(201).json({ message: "Vêtements analysés et enregistrés", clothes: results });

  } catch (error) {
    console.error("Erreur analyse IA:", error);
    res.status(500).json({ error: "Échec d’analyse", details: error.message });
  }
});

module.exports = router;
