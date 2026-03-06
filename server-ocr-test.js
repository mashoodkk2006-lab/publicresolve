const express = require("express");
const session = require("express-session");
const path = require("path");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const db = require("./db");

const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(express.static("views"));
app.use(express.static("uploads"));
app.use("/uploads", express.static("uploads"));

// Session setup
app.use(session({
  secret: "complaint_secret",
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 }
});

// ============ SERVER-SIDE OCR CHECK ENDPOINT ============
app.post('/api/check-id', upload.single('id_proof_image'), async (req, res) => {
  const fs = require('fs');
  
  try {
    const { idType, idNumber } = req.body;
    
    // Validation
    if (!req.file) {
      return res.status(400).json({ error: 'ID proof file is required' });
    }
    if (!idType || !idNumber) {
      return res.status(400).json({ error: 'idType and idNumber are required' });
    }

    console.log(`[OCR] Starting check - Type: ${idType}, Number: ${idNumber}, File: ${req.file.filename}`);

    try {
      const { createWorker } = require('tesseract.js');
      const worker = await createWorker();
      
      console.log('[OCR] Worker created, loading language...');
      await worker.load();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      
      console.log('[OCR] Worker initialized, recognizing image...');
      const { data: { text } } = await worker.recognize(req.file.path);
      
      console.log('[OCR] Recognition complete, terminating worker...');
      await worker.terminate();

      console.log('[OCR] Extracted text:', text.substring(0, 300));

      // Normalize search
      const normalizedEntered = idNumber.replace(/\s/g, '').toUpperCase();
      let found = false;
      let foundValue = '';

      if (idType === 'Aadhar') {
        const digits = text.replace(/\D/g, '');
        if (digits.includes(normalizedEntered)) {
          found = true;
          foundValue = normalizedEntered;
        }
      } else if (idType === 'PAN') {
        const cleaned = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (cleaned.includes(normalizedEntered)) {
          found = true;
          foundValue = normalizedEntered;
        }
      } else {
        const cleaned = text.replace(/\s+/g, '').toUpperCase();
        if (cleaned.includes(normalizedEntered)) {
          found = true;
          foundValue = normalizedEntered;
        }
      }

      console.log('[OCR] Match result:', found ? 'FOUND' : 'NOT FOUND');

      // Clean up temp file
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('[OCR] Error deleting temp file:', err);
      });

      return res.json({ 
        found, 
        foundValue, 
        text: text.substring(0, 500)
      });

    } catch (ocrErr) {
      console.error('[OCR] Tesseract error:', ocrErr.message);
      
      // Clean up on error
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('[OCR] Error deleting temp file:', err);
      });
      
      return res.status(500).json({ 
        error: 'OCR processing failed: ' + ocrErr.message 
      });
    }

  } catch (err) {
    console.error('[OCR] Request error:', err.message);
    if (req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('[OCR] Error deleting temp file:', err);
      });
    }
    return res.status(500).json({ error: 'Server error during OCR' });
  }
});

// ============ REST OF SERVER.JS ============
// ... (rest of the existing server.js code continues below)
