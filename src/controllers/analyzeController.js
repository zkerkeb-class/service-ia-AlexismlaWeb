const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
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
  const userId = req.body.userId;

  if (!userId) {
    return res.status(400).json({ error: "userId est requis." });
  }

  try {
    // 1. Compresser et convertir l'image
    const compressedBuffer = await sharp(imagePath)
      .resize({ width: 1024 })
      .jpeg({ quality: 80 })
      .toBuffer();

    // 2. Upload image compressée sur ImageKit
    const uploadResponse = await imagekit.upload({
      file: compressedBuffer,
      fileName: originalName + ".jpg",
      folder: "/dressing/"
    });
    const uploadedImageUrl = uploadResponse.url;
    const uploadedFileId = uploadResponse.fileId;

    console.log("✅ Image optimisée uploadée :", uploadedImageUrl);

    // 3. Supprimer fichier local
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);

    // 4. Retirer fond via Replicate
    const replicateResponse = await replicate.run(
      "851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc",
      { input: { image: uploadedImageUrl } }
    );
    const cleanedImageUrl = replicateResponse;

    if (!cleanedImageUrl) {
      throw new Error("Erreur de suppression du fond");
    }

    console.log("✅ Image fond blanc créée :", cleanedImageUrl);

    // 5. Télécharger image nettoyée et uploader sur ImageKit
    const finalImageBuffer = (await axios.get(cleanedImageUrl, { responseType: "arraybuffer" })).data;

    await imagekit.deleteFile(uploadedFileId); // Supprimer l'ancienne image
    console.log("🗑️ Image brute supprimée");

    const finalUpload = await imagekit.upload({
      file: finalImageBuffer,
      fileName: "cleaned-" + originalName + ".jpg",
      folder: "/dressing/",
    });
    const finalImageUrl = finalUpload.url;
    console.log("✅ Image finale uploadée :", finalImageUrl);

    // 6. Envoi à OpenAI pour analyse
    const fileUpload = await openai.files.create({
      file: Buffer.from(finalImageBuffer),
      purpose: "assistants",
    });

    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: [
        {
          type: "text",
          text: `
          Analyse cette image et retourne uniquement ce format JSON :

          [
            {
              "type": "t-shirt",
              "color": "noir",
              "style": "casual",
              "brand": "nike",
              "suggestedBrands": ["nike", "adidas", "puma"],
              "season": "summer"
            }
          ]
          `,
        },
        {
          type: "image_file",
          image_file: { file_id: fileUpload.id },
        }
      ],
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    let completedRun;
    while (true) {
      completedRun = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      if (completedRun.status === "completed") break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

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

    // 7. Sauvegarder dans ta BDD
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
