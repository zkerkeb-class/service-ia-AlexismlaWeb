require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const app = express();

// Security middlewares
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8081'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // limit each IP to 300 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/health', (_req, res) => res.status(200).json({ ok: true }));

// Routes
const analyzeRouter = require("./controllers/analyzeController");
const recommendationRoute = require("./controllers/recommendation");

app.use("/analyze", analyzeRouter);
app.use("/recommendation", recommendationRoute);

const PORT = process.env.PORT || 4002;
app.listen(PORT, () => {
  console.log(`🚀 IA service running on port ${PORT}`);
});
