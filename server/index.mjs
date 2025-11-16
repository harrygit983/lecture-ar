import express from "express";
import FormData from "form-data";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = [
  "http://localhost:5173",
  "chatvision-kon9r2ruy-harrygit983s-projects.vercel.app" // etc
];
// CORS: allow all origins for now
app.use(
  cors({
    origin: true,       // reflect the request origin
    credentials: true,  // in case you ever use cookies/auth
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello from Render backend!");
});

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + "-" + file.originalname);
  }
});
const upload = multer({ storage });

// Gemini client (File Search, Files, Models) :contentReference[oaicite:5]{index=5}
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Simple in-memory map lectureId → fileSearchStoreName
const lectureStores = new Map();

/**
 * Helper: create a new File Search store for each lecture.
 * You could reuse one store for all lectures if you add metadata filters later. :contentReference[oaicite:6]{index=6}
 */
async function createLectureStore(displayName) {
  const store = await ai.fileSearchStores.create({
    config: { displayName }
  });
  return store.name; // e.g. "fileSearchStores/xyz"
}

/**
 * Helper: upload a local file and import into File Search store.
 * Uses Files API + fileSearchStores.importFile pattern.
 */
async function uploadFileToStore(storeName, localPath, displayName, mimeType) {
  // 1) Upload via Files API
  const uploaded = await ai.files.upload({
    file: localPath,
    config: {
      // ⚠️ DO NOT set `name` here, let Gemini assign it.
      mimeType,
      displayName
    }
  });

  // At this point `uploaded.name` is like "files/abc123..."
  // 2) Import into File Search store
  let op = await ai.fileSearchStores.importFile({
    fileSearchStoreName: storeName,
    fileName: uploaded.name
  });

  // 3) Wait until import is done
  while (!op.done) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    op = await ai.operations.get({ operation: op });
  }
}

/**
 * Helper: call ElevenLabs STT on a local audio file.
 * Uses the /v1/speech-to-text endpoint with multipart/form-data. :contentReference[oaicite:8]{index=8}
 */
async function transcribeWithElevenLabs(audioPath) {
  const formData = new FormData();
  formData.append("file", fs.createReadStream(audioPath));
  // You can tweak params as needed, check docs for model & language options.
  formData.append("model_id", "scribe_v1");

  const response = await axios.post(
    "https://api.elevenlabs.io/v1/speech-to-text",
    formData,
    {
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        ...formData.getHeaders?.()
      }
    }
  );

  // ElevenLabs returns JSON; main transcript text is usually in `text`
  return response.data.text || JSON.stringify(response.data);
}

/**
 * POST /api/upload-lecture
 * multipart/form-data:
 *  - slides (PDF)
 *  - audio (mp3/wav)
 *  - title (optional text)
 */
app.post(
  "/api/upload-lecture",
  upload.fields([
    { name: "slides", maxCount: 1 },
    { name: "audio", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const title = req.body.title || "Untitled Lecture";
      const slidesFile = req.files?.slides?.[0];
      const audioFile = req.files?.audio?.[0];

      if (!slidesFile || !audioFile) {
        return res.status(400).json({ error: "slides and audio are required" });
      }

      // 1) Transcribe the lecture audio
      const transcript = await transcribeWithElevenLabs(audioFile.path);

      // 2) Create a file search store for this lecture
      const storeName = await createLectureStore(`lecture-${Date.now()}`);

      // 3) Upload slides PDF to the store
      await uploadFileToStore(
        storeName,
        slidesFile.path,
        `${title}-slides`,
        "application/pdf"
      );

      // 4) Save transcript as a .txt and upload to store
      const transcriptPath = path.join(
        uploadsDir,
        `${path.basename(audioFile.filename)}.txt`
      );
      fs.writeFileSync(transcriptPath, transcript, "utf-8");

      await uploadFileToStore(
        storeName,
        transcriptPath,
        `${title}-transcript`,
        "text/plain"
      );

      // 5) Generate a simple lectureId and remember mapping
      const lectureId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      lectureStores.set(lectureId, storeName);

      res.json({
        lectureId,
        storeName,
        transcript,
        title
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to process lecture" });
    }
  }
);

/**
 * POST /api/ask
 * body: { lectureId, question }
 * Uses Gemini generateContent with File Search tool enabled. :contentReference[oaicite:9]{index=9}
 */
app.post("/api/ask", async (req, res) => {
  try {
    const { lectureId, question } = req.body;
    const storeName = lectureStores.get(lectureId);

    if (!storeName) {
      return res.status(400).json({ error: "Unknown lectureId" });
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: question,
      config: {
        tools: [
          {
            fileSearch: {
              fileSearchStoreNames: [storeName]
            }
          }
        ]
      }
    });

    const answer = response.text ?? "No answer text returned.";
    res.json({ answer });
  } catch (err) {
    console.error(err?.response?.data || err);
    res.status(500).json({ error: "Failed to query Gemini" });
  }
});
app.post(
  "/api/ask-voice",
  upload.single("questionAudio"),
  async (req, res) => {
    try {
      const { lectureId } = req.body;
      const audioFile = req.file;

      if (!lectureId) {
        return res.status(400).json({ error: "lectureId is required" });
      }
      if (!audioFile) {
        return res.status(400).json({ error: "questionAudio file is required" });
      }

      const storeName = lectureStores.get(lectureId);
      if (!storeName) {
        return res.status(400).json({ error: "Unknown lectureId" });
      }

      // 1) Transcribe spoken question with ElevenLabs
      const questionText = await transcribeWithElevenLabs(audioFile.path);

      // 2) Ask Gemini with File Search, same as /api/ask
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: questionText,
        config: {
          tools: [
            {
              fileSearch: {
                fileSearchStoreNames: [storeName]
              }
            }
          ]
        }
      });

      const answer = response.text ?? "No answer text returned.";

      res.json({ questionText, answer });
    } catch (err) {
      console.error(err?.response?.data || err);
      res.status(500).json({ error: "Failed to process voice question" });
    }
  }
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});