require("dotenv").config();
const express = require("express");
const app = express();

// ⬇️ Middleware JSON indispensable pour parser req.body
app.use(express.json());

// Routes
const analyzeRouter = require("./controllers/analyzeController");
const recommendationRoute = require("./controllers/recommendation");

app.use("/analyze", analyzeRouter);
app.use("/recommendation", recommendationRoute);

const PORT = process.env.PORT || 4002;
app.listen(PORT, () => {
  console.log(`🚀 IA service running on port ${PORT}`);
});
