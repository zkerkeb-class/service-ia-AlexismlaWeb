const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const axios = require("axios");
const Replicate = require("replicate");
const ImageKit = require("imagekit");

require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

// Configuration multer pour les uploads de fichiers
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "..", "..", "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  },
});

const upload = multer({ storage });

router.post("/", async (req, res) => {
  // Middleware multer conditionnel
  const multerMiddleware = upload.single("image");
  
  multerMiddleware(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: "Erreur upload fichier" });
    }
    
    let imagePath, originalName;
    
    // Gérer le cas où on reçoit une URL d'image au lieu d'un fichier
    if (req.body.imageUrl && !req.file) {
      try {
        // Télécharger l'image depuis l'URL
        const response = await axios.get(req.body.imageUrl, { responseType: 'arraybuffer' });
        const tempFileName = `temp_${Date.now()}.jpg`;
        imagePath = path.join(__dirname, '..', '..', 'uploads', tempFileName);
        originalName = 'image';
        
        // Créer le dossier uploads s'il n'existe pas
        const uploadsDir = path.dirname(imagePath);
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        // Sauvegarder l'image temporairement
        fs.writeFileSync(imagePath, response.data);
        console.log("📥 Image téléchargée depuis URL:", req.body.imageUrl);
      } catch (error) {
        console.error("❌ Erreur téléchargement image:", error.message);
        return res.status(400).json({ error: "Impossible de télécharger l'image depuis l'URL" });
      }
    } else if (req.file) {
      imagePath = req.file.path;
      originalName = path.parse(req.file.originalname).name;
    } else {
      return res.status(400).json({ error: "Aucune image fournie (fichier ou URL)" });
    }

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

      // 3. Lancer l'analyse
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

      // 5. Vérifier si l'analyse est valide avant de continuer
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

      // 7. Télécharger l'image nettoyée et l'uploader sur ImageKit
      const finalImageBuffer = (await axios.get(cleanedImageUrl, { responseType: "arraybuffer" })).data;

      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);

      const finalUpload = await imagekit.upload({
        file: finalImageBuffer,
        fileName: originalName + ".jpg",
        folder: "/dressing/",
      });

      const finalImageUrl = finalUpload.url;
      console.log("✅ Image finale uploadée sur ImageKit :", finalImageUrl);
      console.log("🔄 Début de la sauvegarde des vêtements...");

      // 8. Test simple d'enregistrement
      const results = [];
      let hasErrors = false;
      
      for (const clothing of clothesArray) {
        try {
          console.log("🔄 Tentative d'enregistrement du vêtement:", clothing);
          
          // Utiliser directement le tableau suggestedBrands
          const suggestedBrandsArray = Array.isArray(clothing.suggestedBrands) 
            ? clothing.suggestedBrands
            : [];
            
          console.log("🔄 Données à envoyer:", {
            userId: req.body.userId,
            type: clothing.type,
            color: clothing.color,
            style: clothing.style,
            brand: clothing.brand,
            suggestedBrands: suggestedBrandsArray,
            imageUrl: finalImageUrl,
            season: clothing.season || "all",
          });
          
          const saveResponse = await axios.post("http://bdd-service:4001/api/clothing", {
            userId: req.body.userId,
            type: clothing.type,
            color: clothing.color,
            style: clothing.style,
            brand: clothing.brand,
            suggestedBrands: suggestedBrandsArray,
            imageUrl: finalImageUrl,
            season: clothing.season || "all",
          }, {
            headers: {
              Authorization: req.headers.authorization
            }
          });
          
          console.log("✅ Vêtement enregistré avec succès:", saveResponse.data);
          results.push(saveResponse.data);
        } catch (error) {
          hasErrors = true;
          console.error("❌ Erreur enregistrement vêtement :");
          console.error("   Message:", error.message);
          console.error("   Response:", JSON.stringify(error.response?.data, null, 2));
          console.error("   Status:", error.response?.status);
          console.error("   URL:", error.config?.url);
          console.error("   Data envoyée:", JSON.stringify(error.config?.data, null, 2));
          console.error("   Stack:", error.stack);
          console.error("   ERREUR COMPLÈTE:", error);
          
          // Ne pas faire planter le service, continuer avec les autres vêtements
          console.log("⚠️ Continuation avec les autres vêtements...");
        }
      }

      if (hasErrors) {
        console.log("⚠️ Certains vêtements n'ont pas pu être enregistrés");
        res.status(207).json({ 
          message: "Vêtements analysés, certains erreurs d'enregistrement", 
          clothes: results,
          errors: hasErrors 
        });
      } else {
        res.status(201).json({ message: "Vêtements analysés et enregistrés", clothes: results });
      }

    } catch (error) {
      console.error("Erreur analyse IA:", error);
      res.status(500).json({ error: "Échec d'analyse", details: error.message });
    }
  });
});

module.exports = router;

