import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import AdmZip from "adm-zip";
import multer from "multer";
import { analyzeTerraformFiles } from "./terraformParser.js";

dotenv.config({ path: process.env.CONFIG_FILE || "config.env" });

const app = express();
const maxArchiveBytes = 25 * 1024 * 1024;
const maxExpandedBytes = 60 * 1024 * 1024;
const maxArchiveEntries = 2000;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:3000" }));
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxArchiveBytes },
  fileFilter(_req, file, callback) {
    const acceptedMimeTypes = ["application/zip", "application/x-zip-compressed", "application/octet-stream"];
    if (!file.originalname.toLowerCase().endsWith(".zip") || !acceptedMimeTypes.includes(file.mimetype)) {
      callback(new Error("Upload a ZIP archive containing Terraform files."));
      return;
    }
    callback(null, true);
  },
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/analyze", upload.single("archive"), async (req, res, next) => {
  if (!req.file) {
    res.status(400).json({ error: "Choose a ZIP archive to analyze." });
    return;
  }

  try {
    const archive = new AdmZip(req.file.buffer);
    const entries = archive.getEntries();
    if (entries.length > maxArchiveEntries) {
      res.status(413).json({ error: `The archive contains too many files (maximum ${maxArchiveEntries}).` });
      return;
    }

    let expandedBytes = 0;
    const terraformFiles = [];
    for (const entry of entries) {
      const path = entry.entryName.replaceAll("\\", "/");
      if (path.split("/").includes("..")) {
        res.status(400).json({ error: "The archive contains an unsafe file path." });
        return;
      }
      if (entry.isDirectory) continue;

      expandedBytes += entry.header.size;
      if (expandedBytes > maxExpandedBytes) {
        res.status(413).json({ error: "The uncompressed archive is too large to analyze." });
        return;
      }

      if (/\.(?:tf|tf\.json|tfplan\.json|plan\.json)$/i.test(path)) {
        terraformFiles.push({ path, contents: entry.getData().toString("utf8") });
      }
    }

    if (terraformFiles.length === 0) {
      res.status(422).json({ error: "No .tf, .tf.json, or Terraform plan JSON files were found in the ZIP archive." });
      return;
    }

    const analysis = await analyzeTerraformFiles(terraformFiles);
    if (analysis.nodes.length === 0) {
      res.status(422).json({ error: "No Terraform resources or modules were found in the uploaded files." });
      return;
    }
    res.json({ ...analysis, archiveName: req.file.originalname });
  } catch (error) {
    if (error.file || error instanceof SyntaxError) {
      res.status(422).json({ error: "Terraform parsing failed.", file: error.file, detail: error.message });
      return;
    }
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "The ZIP file exceeds the 25 MB upload limit." });
    return;
  }
  res.status(400).json({ error: error.message || "The upload could not be analyzed." });
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Infrastructure analyzer API running on port ${port}`));