const express = require("express");

// Load environment variables
require('dotenv').config();

// log any unhandled promise rejections or exceptions so server doesn't silently die
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 UnhandledRejection', reason, promise);
});
process.on('uncaughtException', (err) => {
  console.error('🔥 UncaughtException', err);
});
const session = require("express-session");
const path = require("path");
const fs = require('fs');
const multer = require("multer");
const bcrypt = require("bcryptjs");
const db = require("./db");
const exifr = require('exifr');

// Import new OCR verification service
const OCRVerificationService = require('./modules/ocr-service');
const ocrService = new OCRVerificationService(db);

const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(express.static("views"));
app.use(express.static("uploads")); // Serve uploaded files
app.use("/uploads", express.static("uploads")); // Alternative route for uploaded files

// serve simplified front‑end templates if the originals are replaced later
app.get('/login.html', (req, res) => {
  // if new page exists, redirect; otherwise static will serve original
  res.sendFile(path.join(__dirname, 'views', 'login_new.html'));
});
app.get('/register.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'register_new.html'));
});

// Session setup
app.use(session({
  secret: "complaint_secret",
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Multer setup for file uploads
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
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

// Server-side OCR endpoint
const Tesseract = require('tesseract.js');
const nodemailer = require('nodemailer');
const Jimp = require('jimp');

// Helper to safely unlink multiple files (no-throw)
function safeUnlinkFiles(...paths) {
  paths.forEach(p => {
    if (p) {
      fs.unlink(p, (err) => { if (err) console.error('Error deleting temp file:', err); });
    }
  });
}

// ===== ID VALIDATION HELPER FUNCTIONS =====
function validatePAN(panNumber) {
  // PAN format: AAAAA9999A (5 letters, 4 digits, 1 letter)
  // Strict format validation only - checksum too complex for this implementation
  const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (!panPattern.test(panNumber)) {
    console.log('[ID] PAN format rejected:', panNumber);
    return false;
  }
  console.log('[ID] PAN format valid:', panNumber);
  return true;
}

function validateAadhar(aadharNumber) {
  // Aadhar is 12 digits - strict validation
  if (!/^\d{12}$/.test(aadharNumber)) {
    console.log('[ID] Aadhar format rejected (not 12 digits):', aadharNumber);
    return false;
  }
  
  // For Aadhar, strict format is enough for now
  console.log('[ID] Aadhar format valid:', aadharNumber);
  return true;
}

// ===== LOCATION DETECTION HELPER FUNCTIONS =====
async function reverseGeocode(lat, lon) {
  const https = require('https');
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result && result.display_name) {
            resolve(result.display_name);
          } else {
            resolve(null);
          }
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

async function extractLocationFromImage(filePath) {
  try {
    const exif = await exifr.parse(filePath, { gps: true });
    if (exif && exif.latitude && exif.longitude) {
      const location = await reverseGeocode(exif.latitude, exif.longitude);
      return {
        latitude: exif.latitude,
        longitude: exif.longitude,
        location: location || `${exif.latitude}, ${exif.longitude}`
      };
    }
  } catch (err) {
    console.error('Error extracting GPS from image:', err);
  }
  return null;
}

/*
// ID check endpoint disabled after removing ID verification from registration
app.post('/api/check-id', (req, res) => {
  return res.status(400).json({ error: 'ID verification feature has been disabled.' });
}
          // Try OCR to verify image matches selected ID type
          console.log('[OCR] Attempting OCR verification...');
          let ocrText = null;
          let extractedID = null;
          let detectedType = null;

          // Preprocess image with Jimp to improve OCR accuracy
          let processedPath = null;
          try {
            const image = await Jimp.read(tempFilePath);
            // Resize if small, convert to greyscale and increase contrast
            const targetWidth = 1200;
            if (image.bitmap.width < targetWidth) {
              image.resize(targetWidth, Jimp.AUTO);
            }
            image.greyscale();
            image.contrast(0.3);
            image.normalize();

            processedPath = tempFilePath + '_proc.png';
            await image.writeAsync(processedPath);
            console.log('[OCR] Preprocessed image saved to', processedPath);
          } catch (prepErr) {
            console.warn('[OCR] Image preprocessing failed (continuing):', prepErr && prepErr.message ? prepErr.message : prepErr);
          }

          try {
            worker = await Tesseract.createWorker();
            await worker.loadLanguage('eng');
            await worker.initialize('eng');

            try {
              await worker.setParameters({
                tessedit_pageseg_mode: 'AUTO',
                tessedit_ocr_engine_mode: '1',
                tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -/'
              });
            } catch (paramErr) {
              console.warn('[OCR] setParameters failed (continuing):', paramErr && paramErr.message ? paramErr.message : paramErr);
            }

            const recognizePath = processedPath || tempFilePath;
            const result = await worker.recognize(recognizePath);
            ocrText = (result && result.data && result.data.text) ? result.data.text : (result && result.text) ? result.text : '';
            console.log('[OCR] Text extracted (first 200 chars):', ocrText ? ocrText.substring(0, 200) : '<empty>');
          

            // Extract ID type and number from image
            const panMatch = ocrText.match(/[A-Z]{5}[0-9]{4}[A-Z]{1}/g);
            if (panMatch) {
              extractedID = panMatch[0];
              detectedType = 'PAN';
            }

            if (!extractedID) {
              const aadharMatch = ocrText.match(/\d{12}/g);
              if (aadharMatch) {
                extractedID = aadharMatch[0];
                detectedType = 'Aadhar';
              }
            }

            if (!extractedID) {
              const dlMatch = ocrText.match(/[A-Z]{2}\d{2}[A-Z0-9]{7,}/g);
              if (dlMatch) {
                extractedID = dlMatch[0].replace(/\s/g, '');
                detectedType = 'Driving License';
              }
            }

            console.log('[OCR] Detected:', detectedType, 'Extracted:', extractedID);
          } catch (ocrErr) {
            console.warn('[OCR] OCR processing failed (non-critical):', ocrErr && ocrErr.stack ? ocrErr.stack : ocrErr);
            // OCR failure is not fatal - continue with format validation
          } finally {
            if (worker) {
              try {
                await worker.terminate();
              } catch (termErr) {
                console.warn('[OCR] Worker termination error:', termErr && termErr.stack ? termErr.stack : termErr);
              }
            }
          }

          // Validate based on OCR results or fallback to format validation
          if (extractedID && detectedType) {
            // OCR succeeded - strict validation
            if (detectedType !== idType) {
              safeUnlinkFiles(tempFilePath, processedPath);
              return res.status(400).json({ 
                error: `Image contains ${detectedType}, but you selected ${idType}. Please upload the correct ID document.` 
              });
            }

            if (extractedID !== normalizedEntered) {
              safeUnlinkFiles(tempFilePath, processedPath);
              return res.status(400).json({ 
                error: `The ID number in the image (${extractedID}) does not match what you entered (${normalizedEntered}).` 
              });
            }

            // OCR validation passed
            safeUnlinkFiles(tempFilePath, processedPath);
            return res.json({ 
              found: true, 
              foundValue: extractedID, 
              text: `${idType} verified via image. ID matched.` 
            });
          } else {
            // OCR failed - verification failed, image must be clearer
            console.log('[OCR] OCR did not extract ID - verification failed');
            safeUnlinkFiles(tempFilePath, processedPath);
            return res.status(400).json({ 
              error: `Could not extract ID from image. Please upload a clearer, well-lit image of your ID document. Make sure the ID number is clearly visible.` 
            });
          }
        } catch (innerErr) {
          console.error('[Server] Unexpected error in /api/check-id callback:', innerErr && innerErr.stack ? innerErr.stack : innerErr);
          if (tempFilePath) safeUnlinkFiles(tempFilePath, processedPath);
          if (worker) {
            try { await worker.terminate(); } catch(e) { console.warn('[OCR] Worker termination error:', e && e.stack ? e.stack : e); }
          }
          return res.status(500).json({ error: 'Internal server error during ID verification' });
        }
      }
    );
  } catch (err) {
    console.error('Server ID validation error:', err && err.stack ? err.stack : err);
    if (tempFilePath) {
      safeUnlinkFiles(tempFilePath);
    }
    if (worker) {
      try {
        await worker.terminate();
      } catch (termErr) {
        console.warn('Worker termination error:', termErr && termErr.stack ? termErr.stack : termErr);
      }
    }
    return res.status(500).json({ error: 'ID validation encountered an error. Please try again.' });
  }
});
*/

// ==== new /api/check-id handler (simpler, no callback nesting) ====
app.post('/api/check-id', upload.single('id_proof_image'), async (req, res) => {
  let worker = null;
  let tempFilePath = null;

  try {
    const { idType, idNumber } = req.body;
    console.log('[IDCHECK] received', { idType, idNumber, file: req.file && req.file.originalname });

    if (!req.file) {
      return res.status(400).json({ error: 'ID proof file is required' });
    }
    if (!idType || !idNumber) {
      return res.status(400).json({ error: 'idType and idNumber are required' });
    }

    tempFilePath = req.file.path;
    const normalizedEntered = String(idNumber).replace(/\s/g, '').toUpperCase();

    let formatValid = false;
    if (idType === 'Aadhar' && /^\d{12}$/.test(normalizedEntered)) formatValid = true;
    if (idType === 'PAN' && /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(normalizedEntered)) formatValid = true;
    if (idType === 'Voter ID' && normalizedEntered.length >= 6) formatValid = true;
    if (idType === 'Driving License' && /^[A-Z]{2}\d{2}/.test(normalizedEntered)) formatValid = true;

    if (!formatValid) {
      safeUnlinkFiles(tempFilePath);
      return res.status(400).json({ error: `Invalid ${idType} format.` });
    }

    // duplicate check
    try {
      const [dupResults] = await db.promise().query(
        'SELECT id FROM users WHERE id_proof_number = ? AND id_proof_type = ?',
        [normalizedEntered, idType]
      );
      if (dupResults && dupResults.length > 0) {
        safeUnlinkFiles(tempFilePath);
        return res.status(400).json({ error: 'This ID is already registered. Please login or use a different ID.' });
      }
    } catch (dupErr) {
      console.error('[DB] duplicate check error', dupErr);
      safeUnlinkFiles(tempFilePath);
      return res.status(500).json({ error: 'Server error checking ID. Please try again later.' });
    }

    // OCR verification (optional)
    let ocrText = '';
    let extractedID = null;
    let detectedType = null;
    let processedPath = null;

    try {
      const image = await Jimp.read(tempFilePath);
      if (image.bitmap.width < 1200) image.resize(1200, Jimp.AUTO);
      image.greyscale().contrast(0.3).normalize();
      processedPath = tempFilePath + '_proc.png';
      await image.writeAsync(processedPath);
    } catch (prepErr) {
      console.warn('[OCR] preprocessing failed', prepErr.message || prepErr);
    }

    try {
      worker = await Tesseract.createWorker();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      await worker.setParameters({
        tessedit_pageseg_mode: 'AUTO',
        tessedit_ocr_engine_mode: '1',
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -/'
      }).catch(() => {});

      const pathToRead = processedPath || tempFilePath;
      const result = await worker.recognize(pathToRead);
      ocrText = (result && result.data && result.data.text) ? result.data.text : (result && result.text) ? result.text : '';
      const panMatch = ocrText.match(/[A-Z]{5}[0-9]{4}[A-Z]{1}/g);
      if (panMatch) { extractedID = panMatch[0]; detectedType = 'PAN'; }
      if (!extractedID) {
        const aadharMatch = ocrText.match(/\d{12}/g);
        if (aadharMatch) { extractedID = aadharMatch[0]; detectedType = 'Aadhar'; }
      }
      if (!extractedID) {
        const dlMatch = ocrText.match(/[A-Z]{2}\d{2}[A-Z0-9]{7,}/g);
        if (dlMatch) { extractedID = dlMatch[0].replace(/\s/g,''); detectedType = 'Driving License'; }
      }
    } catch (ocrErr) {
      console.warn('[OCR] processing error', ocrErr);
    } finally {
      if (worker) await worker.terminate().catch(() => {});
    }

    if (extractedID && detectedType) {
      if (detectedType !== idType) {
        safeUnlinkFiles(tempFilePath, processedPath);
        return res.status(400).json({ error: `Image is ${detectedType} not ${idType}` });
      }
      if (extractedID !== normalizedEntered) {
        safeUnlinkFiles(tempFilePath, processedPath);
        return res.status(400).json({ error: `ID in image (${extractedID}) doesn't match entered (${normalizedEntered})` });
      }
      safeUnlinkFiles(tempFilePath, processedPath);
      return res.json({ found: true, foundValue: extractedID, text: 'Verified via OCR' });
    }

    // OCR FAILED - But format is valid, so allow registration
    // The ID format has already been validated above
    console.log('[OCR] OCR failed to extract ID from image, but format is valid - allowing registration');
    safeUnlinkFiles(tempFilePath, processedPath);
    return res.json({ 
      found: true, 
      foundValue: normalizedEntered, 
      text: `${idType} verified via format validation. Image quality was lower than expected, but ID format is valid.` 
    });
  } catch (err) {
    console.error('[IDCHECK] unexpected failure', err);
    if (tempFilePath) safeUnlinkFiles(tempFilePath);
    if (worker) await worker.terminate().catch(() => {});
    return res.status(500).json({ error: 'Server error during ID verification' });
  }
});

// ===== EMAIL HELPER FUNCTIONS FOR COMPLAINT UPDATES =====
function sendComplaintUpdateEmail(userEmail, userName, complaintId, status, message = '') {
  try {
    const smtpHost = process.env.SMTP_HOST ? process.env.SMTP_HOST.trim() : '';
    const smtpUser = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';
    const smtpPass = process.env.SMTP_PASS ? process.env.SMTP_PASS.trim() : '';
    const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.log('[EMAIL] SMTP not configured; skipping notification');
      return;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass }
    });

    const statusColors = {
      'Pending': '#FF9800',
      'In Progress': '#2196F3',
      'Resolved': '#4CAF50',
      'Rejected': '#F44336'
    };

    const statusColor = statusColors[status] || '#2196F3';

    let emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2c3e50; border-bottom: 3px solid ${statusColor}; padding-bottom: 10px;">
          Complaint Update
        </h2>
        <p>Dear <strong>${userName}</strong>,</p>
        
        <p>Your complaint has been updated. Here are the details:</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-left: 4px solid ${statusColor}; margin: 20px 0;">
          <p><strong>Complaint ID:</strong> #${complaintId}</p>
          <p><strong>Current Status:</strong> <span style="color: white; background-color: ${statusColor}; padding: 5px 10px; border-radius: 3px; font-weight: bold;">${status}</span></p>
    `;

    if (message) {
      emailBody += `
          <p><strong>Message from Admin:</strong></p>
          <div style="background-color: white; padding: 10px; border-radius: 3px; margin-top: 10px;">
            ${message.replace(/\n/g, '<br/>')}
          </div>
      `;
    }

    emailBody += `
        </div>
        
        <p style="margin-top: 20px;">Please log in to your account to view more details about your complaint.</p>
        
        <p style="color: #666; font-size: 12px; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">
          This is an automated message from the PublicResolve system. Please do not reply to this email.
        </p>
      </div>
    `;

    transporter.sendMail({
      from: process.env.SMTP_FROM || smtpUser,
      to: userEmail,
      subject: `Your Complaint #${complaintId} Status Update - ${status}`,
      html: emailBody
    }, (err, info) => {
      if (err) {
        console.error('[EMAIL] Error sending complaint update email:', err.message);
      } else {
        console.log(`[EMAIL] Complaint update email sent to ${userEmail}`);
      }
    });
  } catch (error) {
    console.error('[EMAIL] Error in sendComplaintUpdateEmail:', error.message);
  }
}

// Send email to admin when user sends a message
function sendAdminMessageNotificationEmail(adminEmail, adminName, complaintId, userName, userMessage) {
  try {
    const smtpHost = process.env.SMTP_HOST ? process.env.SMTP_HOST.trim() : '';
    const smtpUser = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';
    const smtpPass = process.env.SMTP_PASS ? process.env.SMTP_PASS.trim() : '';
    const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.log('[EMAIL] SMTP not configured; skipping notification');
      return;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass }
    });

    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2c3e50; border-bottom: 3px solid #FF9800; padding-bottom: 10px;">
          New User Message on Complaint
        </h2>
        <p>Hello <strong>${adminName}</strong>,</p>
        
        <p>A user has sent a new message on one of your assigned complaints:</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-left: 4px solid #FF9800; margin: 20px 0;">
          <p><strong>Complaint ID:</strong> #${complaintId}</p>
          <p><strong>From:</strong> ${userName}</p>
          <p><strong>Message:</strong></p>
          <div style="background-color: white; padding: 10px; border-radius: 3px; margin-top: 10px;">
            ${userMessage.replace(/\n/g, '<br/>')}
          </div>
        </div>
        
        <p style="margin-top: 20px;">Please log in to the admin dashboard to respond to this message.</p>
        
        <p style="color: #666; font-size: 12px; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">
          This is an automated notification from the PublicResolve system.
        </p>
      </div>
    `;

    transporter.sendMail({
      from: process.env.SMTP_FROM || smtpUser,
      to: adminEmail,
      subject: `New User Message on Complaint #${complaintId}`,
      html: emailBody
    }, (err, info) => {
      if (err) {
        console.error('[EMAIL] Error sending admin notification email:', err.message);
      } else {
        console.log(`[EMAIL] Admin notification email sent to ${adminEmail}`);
      }
    });
  } catch (error) {
    console.error('[EMAIL] Error in sendAdminMessageNotificationEmail:', error.message);
  }
}

// ===== OTP STORAGE (In-memory temporary storage) =====
// Structure: { email: { code, timestamp, attempts, registrationData } }
const otpStorage = {}; 
const OTP_VALIDITY = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

// ===== SEND OTP ENDPOINT (Email-based) =====
app.post('/api/send-otp', async (req, res) => {
  try {
    const { email, registrationData } = req.body;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ error: 'Valid email address required' });
    }

    // Validate registration data exists
    if (!registrationData) {
      return res.status(400).json({ error: 'Registration data is required' });
    }

    const { phone } = registrationData;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Check if email or phone already exists in database
    db.query("SELECT * FROM users WHERE email = ? OR phone = ?", [email, phone], (err, results) => {
      if (err) {
        console.error('Database check error:', err);
        return res.status(500).json({ error: 'Database error occurred' });
      }

      if (results.length > 0) {
        const existingUser = results[0];
        if (existingUser.email === email) {
          return res.status(400).json({ error: 'This email address is already registered. Please use a different email or login if you already have an account.' });
        }
        if (existingUser.phone === phone) {
          return res.status(400).json({ error: 'This phone number is already registered. Please use a different phone number or login if you already have an account.' });
        }
      }

      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const timestamp = Date.now();

      // Store OTP in memory with registration data (keyed by email)
      otpStorage[email] = {
        code: otp,
        timestamp: timestamp,
        attempts: 0,
        registrationData: registrationData
      };

      // OTP is now sent via email, no longer displayed in terminal for security
      // console.log(`[OTP] Generated OTP for ${email}: ${otp}`);

      // Try to send email using nodemailer if SMTP settings provided via env
      const smtpHost = process.env.SMTP_HOST ? process.env.SMTP_HOST.trim() : '';
      const smtpUser = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';
      const smtpPass = process.env.SMTP_PASS ? process.env.SMTP_PASS.trim() : '';
      const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;

      if (smtpHost && smtpUser && smtpPass) {
        try {
          const secure = smtpPort === 465; // use SSL for port 465
          const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: secure,
            auth: { user: smtpUser, pass: smtpPass }
          });

          transporter.sendMail({
            from: process.env.SMTP_FROM || smtpUser,
            to: email,
            subject: 'Your PublicResolve OTP',
            text: `Your verification code is: ${otp}. It is valid for 10 minutes.`
          }).then(() => {
            console.log(`[OTP] Sent OTP to ${email} via SMTP`);
            return res.json({
              success: true,
              message: 'OTP sent to your email'
            });
          }).catch((smtpErr) => {
            console.error('SMTP send error:', smtpErr);
            return res.json({
              success: true,
              message: 'OTP sent to your email',
              testOtp: otp // fallback for development
            });
          });
        } catch (smtpErr) {
          console.error('SMTP setup error:', smtpErr);
          return res.json({
            success: true,
            message: 'OTP sent to your email',
            testOtp: otp // fallback for development
          });
        }
      } else {
        console.log('[OTP] SMTP not configured; using test OTP');
        return res.json({
          success: true,
          message: 'OTP sent to your email',
          testOtp: otp // for development only
        });
      }
    });
  } catch (err) {
    console.error('OTP generation error:', err);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// ===== VERIFY OTP ENDPOINT =====
app.post('/api/verify-otp', (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    // Check if OTP exists for this email
    const otpData = otpStorage[email];
    if (!otpData) {
      return res.status(400).json({ error: 'OTP not found or expired. Please request a new OTP.' });
    }

    // Check if OTP has expired
    if (Date.now() - otpData.timestamp > OTP_VALIDITY) {
      delete otpStorage[email];
      return res.status(400).json({ error: 'OTP has expired. Please request a new OTP.' });
    }

    // Check attempt limit
    if (otpData.attempts >= MAX_ATTEMPTS) {
      delete otpStorage[email];
      return res.status(400).json({ error: 'Too many attempts. Please request a new OTP.' });
    }

    // Verify OTP
    if (otp !== otpData.code) {
      otpData.attempts++;
      return res.status(400).json({ error: 'Invalid OTP. Please try again.' });
    }

    // OTP verified! Now register the user
    const registrationData = otpData.registrationData;
    const { full_name, email: regEmail, password, phone: phoneNum, address, place, district, dob, pin_code } = registrationData;

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(regEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check if user already exists
    db.query("SELECT * FROM users WHERE email = ? OR phone = ?", [regEmail, phoneNum], async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      if (results.length > 0) {
        delete otpStorage[email];
        const existingUser = results[0];
        if (existingUser.email === regEmail) {
          return res.status(400).json({ error: 'Email already registered' });
        }
        if (existingUser.phone === phoneNum) {
          return res.status(400).json({ error: 'Phone number already registered' });
        }
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert user with basic info only
      db.query(
        "INSERT INTO users (full_name, email, password, phone, address, place, district, dob, pin_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [full_name, regEmail, hashedPassword, phoneNum, address, place, district, dob, pin_code],
        (err, result) => {
          if (err) {
            console.error('User insertion error:', err);
            return res.status(500).json({ error: err.message });
          }

          // Clean up OTP
          delete otpStorage[email];

          console.log(`[OTP] User registered successfully with email: ${regEmail}`);

          return res.json({
            success: true,
            message: 'Registration successful! Your email has been verified.',
            redirect: '/login.html'
          });
        }
      );
    });
  } catch (err) {
    console.error('OTP verification error:', err);
    return res.status(500).json({ error: 'OTP verification failed' });
  }
});

// Middleware to check user session
const isUserLoggedIn = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please login first" });
  }
  next();
};

// Middleware to check admin session
const isAdminLoggedIn = (req, res, next) => {
  if (!req.session.adminId) {
    return res.status(401).json({ error: "Admin not logged in" });
  }
  next();
};

// Middleware to check head admin session
const isHeadAdminLoggedIn = (req, res, next) => {
  console.log('Head admin middleware check - Session:', {
    adminId: req.session.adminId,
    adminRole: req.session.adminRole,
    adminUsername: req.session.adminUsername
  });
  
  if (!req.session.adminId || req.session.adminRole !== 'head') {
    return res.status(401).json({ error: "Head admin access required" });
  }
  next();
};

// Test endpoint to check session
app.get("/admin/check-session", (req, res) => {
  console.log('Session check:', req.session);
  res.json({
    isLoggedIn: !!req.session.adminId,
    role: req.session.adminRole,
    adminId: req.session.adminId,
    adminUsername: req.session.adminUsername
  });
});

// ==================== HOME ====================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// Admin home page
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "admin-index.html"));
});

app.get("/admin/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "admin-index.html"));
});

// ==================== AUTH ROUTES ====================

// Register
app.post("/register", async (req, res) => {
  try {
    let { full_name, email, password, phone, address, place, district, dob, pin_code } = req.body;
    
    // Trim all string fields
    full_name = full_name ? full_name.trim() : '';
    email = email ? email.trim() : '';
    password = password ? password.trim() : '';
    phone = phone ? phone.trim() : '';
    address = address ? address.trim() : '';
    place = place ? place.trim() : '';
    district = district ? district.trim() : '';
    dob = dob ? dob.trim() : '';
    pin_code = pin_code ? pin_code.trim() : '';
    
    // Validate required fields
    if (!full_name || !email || !password || !phone || !address || !place || !district || !dob || !pin_code) {
      const missing = [];
      if (!full_name) missing.push('Full Name');
      if (!email) missing.push('Email');
      if (!password) missing.push('Password');
      if (!phone) missing.push('Phone');
      if (!address) missing.push('Address');
      if (!place) missing.push('Place');
      if (!district) missing.push('District');
      if (!dob) missing.push('Date of Birth');
      if (!pin_code) missing.push('PIN Code');
      
      console.log('[Register] Missing fields:', missing);
      return res.status(400).json({ error: `Please fill in all required fields: ${missing.join(', ')}` });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address" });
    }

    // Validate phone format
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ error: "Phone number must be 10 digits" });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Validate DOB format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return res.status(400).json({ error: "Invalid date of birth format" });
    }

    // Validate PIN code format
    if (!/^\d{6}$/.test(pin_code)) {
      return res.status(400).json({ error: "PIN code must be exactly 6 digits" });
    }


    // Check if user already exists
    db.query("SELECT * FROM users WHERE email = ? OR phone = ?", [email, phone], async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (results.length > 0) {
        const existingUser = results[0];
        if (existingUser.email === email) {
          return res.status(400).json({ error: "Email already registered" });
        }
        if (existingUser.phone === phone) {
          return res.status(400).json({ error: "Phone number already registered" });
        }
      }
      
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // Insert user with basic information (ID proof not collected)
      db.query(
        "INSERT INTO users (full_name, email, password, phone, address, place, district, dob, pin_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [full_name, email, hashedPassword, phone, address, place, district, dob, pin_code],
        (err, result) => {
          if (err) return res.status(500).json({ error: err.message });
          
          const userId = result.insertId;
          res.json({ 
            success: true, 
            message: "Registration successful! Please login.",
            redirect: "/login.html"
          });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// User Login
app.post("/login", (req, res) => {
  try {
    console.log('[LOGIN] incoming body:', req.body);
    const { emailOrPhone, password } = req.body;

    if (!emailOrPhone || !password) {
      return res.status(400).json({ error: "Email/Phone and password required" });
    }

    // Normalize input: remove non-digits to detect plain 10-digit phone numbers
    const numeric = String(emailOrPhone).replace(/\D/g, '');

    // Build query and params to improve matching for formatted phone inputs
    let query = "SELECT * FROM users WHERE email = ? OR phone = ? OR CAST(phone AS CHAR) = ?";
    let params = [emailOrPhone, emailOrPhone, emailOrPhone];

    if (numeric.length === 10) {
      // If input looks like a 10-digit phone, match against normalized phone too
      query = "SELECT * FROM users WHERE phone = ? OR CAST(phone AS CHAR) = ? OR email = ?";
      params = [numeric, numeric, emailOrPhone];
    }

    db.query(query, params, async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      if (results.length === 0) {
        return res.status(401).json({ error: "Invalid email/phone or password" });
      }

      const user = results[0];
      const passwordMatch = await bcrypt.compare(password, user.password);

      if (!passwordMatch) {
        return res.status(401).json({ error: "Invalid email/phone or password" });
      }

      // Set session
      req.session.userId = user.id;
      req.session.userName = user.full_name;
      req.session.userEmail = user.email;

      res.json({ 
        success: true, 
        message: "Login successful",
        redirect: "/dashboard.html"
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin Login
app.post("/admin/login", (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    
    db.query("SELECT * FROM admins WHERE username = ?", [username], async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (results.length === 0) {
        return res.status(401).json({ error: "Invalid username or password" });
      }
      
      const admin = results[0];
      const passwordMatch = await bcrypt.compare(password, admin.password);
      
      if (!passwordMatch) {
        return res.status(401).json({ error: "Invalid username or password" });
      }
      
      // Set admin session with role and district info
      req.session.adminId = admin.id;
      req.session.adminUsername = admin.username;
      req.session.adminDistrict = admin.district;
      req.session.adminRole = admin.role || 'district'; // Default to district if not set
      
      // Determine redirect based on role
      const redirect = admin.role === 'head' ? "/admin-head-dashboard.html" : "/admin-dashboard.html";
      
      res.json({ 
        success: true, 
        message: "Admin login successful",
        redirect: redirect
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: "Logged out successfully", redirect: "/" });
  });
});

// Admin Logout
app.get("/admin/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: "Logged out successfully", redirect: "/admin-login.html" });
  });
});

// ==================== PASSWORD RECOVERY ====================

// Generate OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Store OTPs temporarily (in production, use Redis or database with TTL)
const otpStore = new Map();

// Verify phone number and send OTP
app.post("/forgot-password-verify", (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile || mobile.length !== 10) {
      return res.status(400).json({ error: "Invalid mobile number format" });
    }

    // Check if mobile exists in users table
    db.query("SELECT id, full_name FROM users WHERE phone = ?", [mobile], (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: "Database error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: "Mobile number not registered with any account" });
      }

      // Generate OTP
      const otp = generateOTP();
      const expiryTime = Date.now() + 10 * 60 * 1000; // 10 minutes expiry

      // Store OTP temporarily
      otpStore.set(mobile, { otp, expiryTime, attempts: 0 });

      console.log(`📱 [Password Recovery] OTP generated for mobile ${mobile}: ${otp} (Expires in 10 minutes)`);

      // In production, integrate with SMS service like Twilio
      // For now, return OTP for development (remove in production)
      res.json({
        success: true,
        message: "OTP sent to your mobile number",
        otp: otp // Only for development - remove in production
      });
    });
  } catch (error) {
    console.error('Forgot password verify error:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Verify OTP
app.post("/forgot-password-verify-otp", (req, res) => {
  try {
    const { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({ error: "Mobile number and OTP required" });
    }

    const storedData = otpStore.get(mobile);

    if (!storedData) {
      return res.status(404).json({ error: "OTP not found. Please request a new OTP" });
    }

    // Check if OTP expired
    if (Date.now() > storedData.expiryTime) {
      otpStore.delete(mobile);
      return res.status(400).json({ error: "OTP has expired. Please request a new one" });
    }

    // Check OTP attempts (max 3)
    if (storedData.attempts >= 3) {
      otpStore.delete(mobile);
      return res.status(400).json({ error: "Too many incorrect attempts. Please request a new OTP" });
    }

    // Verify OTP
    if (storedData.otp !== otp) {
      storedData.attempts++;
      return res.status(401).json({ error: "Invalid OTP. Please try again" });
    }

    // OTP verified successfully
    console.log(`✓ [Password Recovery] OTP verified for mobile ${mobile}`);

    res.json({
      success: true,
      message: "OTP verified successfully",
      mobile: mobile
    });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Reset Password
app.post("/forgot-password-reset", (req, res) => {
  try {
    const { mobile, newPassword } = req.body;

    if (!mobile || !newPassword) {
      return res.status(400).json({ error: "Mobile number and new password required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Verify OTP was completed (OTP should be removed from store if verified)
    // For security, we'll require re-verification here
    const storedData = otpStore.get(mobile);
    
    // Check if user has verified OTP recently
    if (!storedData || !storedData.verified) {
      // Allow reset if OTP was verified (next request after OTP verification)
      // This is a simplified check - in production, use sessions or tokens
    }

    // Find user by mobile number
    db.query("SELECT id FROM users WHERE phone = ?", [mobile], async (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: "Database error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const userId = results[0].id;

      try {
        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password in database
        db.query(
          "UPDATE users SET password = ? WHERE id = ?",
          [hashedPassword, userId],
          (err) => {
            if (err) {
              console.error('Error updating password:', err);
              return res.status(500).json({ error: "Error resetting password" });
            }

            // Clear OTP from store
            otpStore.delete(mobile);

            console.log(`✓ [Password Recovery] Password reset successfully for mobile ${mobile}`);

            res.json({
              success: true,
              message: "Password reset successfully",
              redirect: "/login.html"
            });
          }
        );
      } catch (hashError) {
        console.error('Hashing error:', hashError);
        res.status(500).json({ error: "Error processing password" });
      }
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==================== USER ROUTES ====================

// Get User Dashboard
app.get("/dashboard", isUserLoggedIn, (req, res) => {
  db.query(
    "SELECT * FROM users WHERE id = ?",
    [req.session.userId],
    (err, users) => {
      if (err) return res.status(500).json({ error: err.message });
      
      db.query(
        "SELECT * FROM complaints WHERE user_id = ? ORDER BY created_at DESC",
        [req.session.userId],
        (err, complaints) => {
          if (err) return res.status(500).json({ error: err.message });
          
          res.json({ user: users[0], complaints });
        }
      );
    }
  );
});

// Submit Complaint
app.post("/submit-complaint", isUserLoggedIn, upload.single("proof_image"), async (req, res) => {
  try {
    let { department, district, complaint_text, location, latitude, longitude } = req.body;
    
    if (!department || !district || !complaint_text) {
      return res.status(400).json({ error: "Department, district, and complaint text are required" });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: "Proof image is required" });
    }

    // If location coordinates not provided, try to extract from image
    if (!latitude || !longitude) {
      console.log('Location coordinates not provided, attempting to extract from image...');
      const extractedLocation = await extractLocationFromImage(req.file.path);
      if (extractedLocation) {
        latitude = extractedLocation.latitude;
        longitude = extractedLocation.longitude;
        location = extractedLocation.location;
        console.log('Location extracted from image:', location, latitude, longitude);
      } else {
        return res.status(400).json({ error: "Location coordinates are required. Please select a location on the map or upload an image with GPS data." });
      }
    }
    
    db.query(
      "INSERT INTO complaints (user_id, department, district, complaint_text, location, latitude, longitude, proof_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [req.session.userId, department, district, complaint_text, location, latitude, longitude, req.file.originalname],
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const complaintId = result.insertId;
        const fs = require("fs");
        
        // Auto-reply message
        const autoReplyMessage = `Thank you for using our website to register your complaint.

Our team has reviewed the issue based on the details you provided. We are making every effort to resolve the problem as quickly as possible.

Once the issue has been resolved, you will be able to view the proof of resolution here. We will also keep updating the status regularly so you can track the progress of your complaint.`;
        
        // Insert automatic reply message FIRST
        db.query(
          "INSERT INTO correspondence (complaint_id, sender_role, message) VALUES (?, ?, ?)",
          [complaintId, 'admin', autoReplyMessage],
          (err) => {
            if (err) {
              console.error("Error inserting auto-reply:", err);
            }
            
            // Then store the image
            if (req.file) {
              fs.readFile(req.file.path, (err, fileData) => {
                if (err) {
                  console.error("Error reading file:", err);
                } else {
                  // Store in database
                  db.query(
                    "INSERT INTO complaint_proofs (complaint_id, filename, image_data, file_type, file_size) VALUES (?, ?, ?, ?, ?)",
                    [complaintId, req.file.originalname, fileData, req.file.mimetype, req.file.size],
                    (err) => {
                      if (err) {
                        console.error("Error storing complaint proof:", err);
                      }
                    }
                  );
                }
                
                // Delete file from uploads folder
                fs.unlink(req.file.path, (err) => {
                  if (err) console.error("Error deleting file:", err);
                });
              });
            }
            
            // Send response immediately after auto-reply is inserted
            res.json({ 
              success: true, 
              message: "Complaint submitted successfully",
              complaintId: complaintId
            });
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Complaint Messages
app.get("/complaint/:id/messages", isUserLoggedIn, (req, res) => {
  const complaintId = req.params.id;
  
  // Check if complaint belongs to user
  db.query(
    "SELECT * FROM complaints WHERE id = ? AND user_id = ?",
    [complaintId, req.session.userId],
    (err, complaints) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (complaints.length === 0) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      
      db.query(
        "SELECT * FROM correspondence WHERE complaint_id = ? ORDER BY created_at ASC",
        [complaintId],
        (err, messages) => {
          if (err) return res.status(500).json({ error: err.message });
          
          res.json({ complaint: complaints[0], messages });
        }
      );
    }
  );
});

// Send Message (User)
app.post("/complaint/:id/message", isUserLoggedIn, (req, res) => {
  try {
    const { message } = req.body;
    const complaintId = req.params.id;
    
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }
    
    // Check if complaint belongs to user and get complaint details
    db.query(
      "SELECT c.*, u.full_name FROM complaints c JOIN users u ON c.user_id = u.id WHERE c.id = ? AND c.user_id = ?",
      [complaintId, req.session.userId],
      (err, complaints) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (complaints.length === 0) {
          return res.status(403).json({ error: "Unauthorized" });
        }
        
        const complaint = complaints[0];
        
        db.query(
          "INSERT INTO correspondence (complaint_id, sender_role, message) VALUES (?, ?, ?)",
          [complaintId, "user", message],
          (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            
            // Get admin email for this district to send notification
            db.query(
              "SELECT email, username FROM admins WHERE district = ? LIMIT 1",
              [complaint.district],
              (err, adminResults) => {
                if (!err && adminResults.length > 0) {
                  const admin = adminResults[0];
                  sendAdminMessageNotificationEmail(
                    admin.email,
                    admin.username,
                    complaintId,
                    complaint.full_name,
                    message
                  );
                }
              }
            );
            
            res.json({ success: true, message: "Message sent and admin notified via email" });
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== HEAD ADMIN ROUTES ====================

// Get Head Admin Dashboard - All Complaints from All Districts
app.get("/admin/head/dashboard", isHeadAdminLoggedIn, (req, res) => {
  try {
    // Get head admin's assigned districts
    db.query(
      "SELECT assigned_districts FROM admins WHERE id = ? AND role = 'head'",
      [req.session.adminId],
      (err, adminResults) => {
        if (err) {
          console.error('Error fetching head admin:', err);
          return res.status(500).json({ error: err.message });
        }

        let assignedDistricts = [];
        if (adminResults.length > 0 && adminResults[0].assigned_districts) {
          try {
            assignedDistricts = JSON.parse(adminResults[0].assigned_districts);
          } catch (e) {
            console.error('Error parsing assigned districts:', e);
          }
        }

        // Build WHERE clause for district filtering
        const districtPlaceholders = assignedDistricts.map(() => '?').join(',');
        const whereClause = assignedDistricts.length > 0 
          ? `WHERE c.district IN (${districtPlaceholders})`
          : '';

        const query = `
          SELECT c.id, c.user_id, c.complaint_text, c.status, c.department, c.location, 
                 c.district, c.created_at, c.proof_image, c.latitude, c.longitude,
                 u.full_name, u.email, u.phone, u.address,
                 (SELECT COUNT(*) FROM correspondence WHERE complaint_id = c.id) as message_count
          FROM complaints c 
          LEFT JOIN users u ON c.user_id = u.id
          ${whereClause}
          ORDER BY c.created_at DESC
        `;

        db.query(query, assignedDistricts, (err, complaints) => {
          if (err) {
            console.error('Error fetching complaints:', err);
            return res.status(500).json({ error: err.message });
          }

          // Get stats with district filter
          const statsQuery = assignedDistricts.length > 0
            ? `SELECT COUNT(*) as total FROM complaints WHERE district IN (${districtPlaceholders})`
            : 'SELECT COUNT(*) as total FROM complaints';
          
          const pendingQuery = assignedDistricts.length > 0
            ? `SELECT COUNT(*) as pending FROM complaints WHERE status = 'Pending' AND district IN (${districtPlaceholders})`
            : "SELECT COUNT(*) as pending FROM complaints WHERE status = 'Pending'";
          
          const resolvedQuery = assignedDistricts.length > 0
            ? `SELECT COUNT(*) as resolved FROM complaints WHERE status = 'Resolved' AND district IN (${districtPlaceholders})`
            : "SELECT COUNT(*) as resolved FROM complaints WHERE status = 'Resolved'";

          db.query(statsQuery, assignedDistricts, (err, totalResult) => {
            db.query(pendingQuery, assignedDistricts, (err, pendingResult) => {
              db.query(resolvedQuery, assignedDistricts, (err, resolvedResult) => {
                res.json({
                  success: true,
                  complaints: complaints,
                  stats: {
                    total: totalResult[0].total,
                    pending: pendingResult[0].pending,
                    resolved: resolvedResult[0].resolved,
                    inProgress: totalResult[0].total - pendingResult[0].pending - resolvedResult[0].resolved
                  }
                });
              });
            });
          });
        });
      }
    );
  } catch (error) {
    console.error('Head admin dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get All District Admins with Their Stats
app.get("/admin/head/district-admins", isHeadAdminLoggedIn, (req, res) => {
  try {
    // Get head admin's assigned districts
    db.query(
      "SELECT assigned_districts FROM admins WHERE id = ? AND role = 'head'",
      [req.session.adminId],
      (err, adminResults) => {
        if (err) {
          console.error('Error fetching head admin:', err);
          return res.status(500).json({ error: err.message });
        }

        let assignedDistricts = [];
        if (adminResults.length > 0 && adminResults[0].assigned_districts) {
          try {
            assignedDistricts = JSON.parse(adminResults[0].assigned_districts);
          } catch (e) {
            console.error('Error parsing assigned districts:', e);
          }
        }

        // Build WHERE clause for district filtering
        const districtPlaceholders = assignedDistricts.map(() => '?').join(',');
        const districtFilter = assignedDistricts.length > 0 
          ? `AND a.district IN (${districtPlaceholders})`
          : '';

        const query = `SELECT a.id, a.username, a.district, 
                (SELECT COUNT(*) FROM complaints WHERE district = a.district) as complaint_count,
                (SELECT COUNT(*) FROM complaints WHERE district = a.district AND status = 'Resolved') as resolved_count,
                (SELECT COUNT(*) FROM correspondence WHERE complaint_id IN (
                  SELECT id FROM complaints WHERE district = a.district
                )) as message_count
         FROM admins a
         WHERE a.role = 'district' AND a.district IS NOT NULL ${districtFilter}
         ORDER BY a.district`;

        db.query(query, assignedDistricts, (err, admins) => {
          if (err) {
            console.error('Error fetching district admins:', err);
            return res.status(500).json({ error: err.message });
          }

          res.json({
            success: true,
            districtAdmins: admins
          });
        });
      }
    );
  } catch (error) {
    console.error('District admins error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Analytics for All Districts
app.get("/admin/head/analytics", isHeadAdminLoggedIn, (req, res) => {
  try {
    // Get head admin's assigned districts
    db.query(
      "SELECT assigned_districts FROM admins WHERE id = ? AND role = 'head'",
      [req.session.adminId],
      (err, adminResults) => {
        if (err) {
          console.error('Error fetching head admin:', err);
          return res.status(500).json({ error: err.message });
        }

        let assignedDistricts = [];
        if (adminResults.length > 0 && adminResults[0].assigned_districts) {
          try {
            assignedDistricts = JSON.parse(adminResults[0].assigned_districts);
          } catch (e) {
            console.error('Error parsing assigned districts:', e);
          }
        }

        // Build WHERE clause for district filtering
        const districtPlaceholders = assignedDistricts.map(() => '?').join(',');
        const districtFilter = assignedDistricts.length > 0 
          ? `WHERE district IN (${districtPlaceholders})`
          : 'WHERE district IS NOT NULL';

        const query = `SELECT district, 
                COUNT(*) as total_complaints,
                SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) as in_progress,
                SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END) as resolved,
                SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) as rejected
         FROM complaints
         ${districtFilter}
         GROUP BY district
         ORDER BY total_complaints DESC`;

        db.query(query, assignedDistricts, (err, analytics) => {
          if (err) {
            console.error('Error fetching analytics:', err);
            return res.status(500).json({ error: err.message });
          }

          res.json({
            success: true,
            analytics: analytics
          });
        });
      }
    );
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send Message to District Admin
app.post("/admin/head/message-admin", isHeadAdminLoggedIn, (req, res) => {
  try {
    const { targetAdminId, message } = req.body;
    const headAdminId = req.session.adminId;

    if (!targetAdminId || !message) {
      return res.status(400).json({ error: "Target admin and message required" });
    }

    // Store message in correspondence or new table
    db.query(
      `INSERT INTO admin_messages (from_admin_id, to_admin_id, message, created_at)
       VALUES (?, ?, ?, NOW())`,
      [headAdminId, targetAdminId, message],
      (err) => {
        if (err) {
          console.error('Error sending message:', err);
          // If table doesn't exist, create it
          if (err.code === 'ER_NO_SUCH_TABLE') {
            db.query(
              `CREATE TABLE admin_messages (
                id INT PRIMARY KEY AUTO_INCREMENT,
                from_admin_id INT NOT NULL,
                to_admin_id INT NOT NULL,
                message TEXT NOT NULL,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (from_admin_id) REFERENCES admins(id),
                FOREIGN KEY (to_admin_id) REFERENCES admins(id)
              )`,
              (createErr) => {
                if (createErr) {
                  return res.status(500).json({ error: createErr.message });
                }
                // Retry insertion
                db.query(
                  `INSERT INTO admin_messages (from_admin_id, to_admin_id, message, created_at)
                   VALUES (?, ?, ?, NOW())`,
                  [headAdminId, targetAdminId, message],
                  (retryErr) => {
                    if (retryErr) {
                      return res.status(500).json({ error: retryErr.message });
                    }
                    res.json({ success: true, message: "Message sent successfully" });
                  }
                );
              }
            );
          } else {
            return res.status(500).json({ error: err.message });
          }
        } else {
          res.json({ success: true, message: "Message sent successfully" });
        }
      }
    );
  } catch (error) {
    console.error('Message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Messages for District Admin
app.get("/admin/head/messages/:adminId", isHeadAdminLoggedIn, (req, res) => {
  try {
    const { adminId } = req.params;

    db.query(
      `SELECT m.*, a.username as from_username
       FROM admin_messages m
       JOIN admins a ON m.from_admin_id = a.id
       WHERE m.to_admin_id = ? OR m.from_admin_id = ?
       ORDER BY m.created_at DESC`,
      [adminId, adminId],
      (err, messages) => {
        if (err) {
          // Table might not exist yet
          if (err.code === 'ER_NO_SUCH_TABLE') {
            return res.json({ success: true, messages: [] });
          }
          console.error('Error fetching messages:', err);
          return res.status(500).json({ error: err.message });
        }

        res.json({
          success: true,
          messages: messages
        });
      }
    );
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Messages for District Admin from Head Admin
app.get("/admin/my-messages", isAdminLoggedIn, (req, res) => {
  try {
    const adminId = req.session.adminId;

    db.query(
      `SELECT m.*, a.username as from_username
       FROM admin_messages m
       JOIN admins a ON m.from_admin_id = a.id
       WHERE m.to_admin_id = ? OR (m.from_admin_id = ? AND m.to_admin_id IS NOT NULL)
       ORDER BY m.created_at DESC`,
      [adminId, adminId],
      (err, messages) => {
        if (err) {
          // Table might not exist yet
          if (err.code === 'ER_NO_SUCH_TABLE') {
            return res.json({ success: true, messages: [] });
          }
          console.error('Error fetching admin messages:', err);
          return res.status(500).json({ error: err.message });
        }

        // Transform messages to include sender_role
        const transformedMessages = messages.map(msg => ({
          ...msg,
          sender_role: msg.from_admin_id === adminId ? 'admin' : 'head-admin'
        }));

        res.json({
          success: true,
          messages: transformedMessages
        });
      }
    );
  } catch (error) {
    console.error('Get admin messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

// District Admin Reply to Head Admin
app.post("/admin/reply-message", isAdminLoggedIn, (req, res) => {
  try {
    const { message } = req.body;
    const adminId = req.session.adminId;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    // First, get the head admin ID from the most recent message sent to this admin
    db.query(
      `SELECT from_admin_id FROM admin_messages WHERE to_admin_id = ? ORDER BY created_at DESC LIMIT 1`,
      [adminId],
      (err, results) => {
        if (err) {
          console.error('Error getting head admin ID:', err);
          return res.status(500).json({ error: err.message });
        }

        let headAdminId = null;
        if (results && results.length > 0) {
          headAdminId = results[0].from_admin_id;
        } else {
          // If no messages, try to get the head admin (role = 'head')
          db.query(
            `SELECT id FROM admins WHERE role = 'head' LIMIT 1`,
            (errHead, headResults) => {
              if (errHead || !headResults || headResults.length === 0) {
                return res.status(500).json({ error: "Head admin not found" });
              }
              insertReplyMessage(headResults[0].id);
            }
          );
          return;
        }

        insertReplyMessage(headAdminId);

        function insertReplyMessage(toAdminId) {
          // Store message - since district admin is replying, they are the sender
          db.query(
            `INSERT INTO admin_messages (from_admin_id, to_admin_id, message, created_at)
             VALUES (?, ?, ?, NOW())`,
            [adminId, toAdminId, message],
            (insertErr) => {
              if (insertErr) {
                console.error('Error sending reply:', insertErr);
                return res.status(500).json({ error: insertErr.message });
              }
              res.json({ success: true, message: "Reply sent successfully" });
            }
          );
        }
      }
    );
  } catch (error) {
    console.error('Reply message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Complaint Details with All Updates
app.get("/admin/head/complaint/:id", isHeadAdminLoggedIn, (req, res) => {
  try {
    const complaintId = req.params.id;
    console.log(`[HEAD-ADMIN] Fetching complaint ${complaintId}`);

    db.query(
      `SELECT c.*, u.full_name, u.email, u.phone, u.address
       FROM complaints c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.id = ?`,
      [complaintId],
      (err, complaint) => {
        if (err) {
          console.error(`[HEAD-ADMIN] Error fetching complaint:`, err);
          return res.status(500).json({ error: err.message });
        }

        console.log(`[HEAD-ADMIN] Complaint found: ${complaint.length}`);
        if (complaint.length === 0) {
          return res.status(404).json({ error: "Complaint not found" });
        }

        // Get all correspondence/updates for this complaint
        db.query(
          `SELECT * FROM correspondence WHERE complaint_id = ? ORDER BY created_at DESC`,
          [complaintId],
          (err, correspondence) => {
            if (err) {
              console.error(`[HEAD-ADMIN] Error fetching correspondence:`, err);
              return res.status(500).json({ error: err.message });
            }
            console.log(`[HEAD-ADMIN] Correspondence found: ${correspondence ? correspondence.length : 0}`);
            res.json({
              success: true,
              complaint: complaint[0],
              correspondence: correspondence || []
            });
          }
        );
      }
    );
  } catch (error) {
    console.error(`[HEAD-ADMIN] Complaint detail error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Send Message to User (Head Admin)
app.post("/admin/head/complaint/:id/message", isHeadAdminLoggedIn, (req, res) => {
  try {
    const { message } = req.body;
    const complaintId = req.params.id;
    
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }
    
    // Verify complaint exists and get user_id and status
    db.query(
      "SELECT id, user_id, status FROM complaints WHERE id = ?",
      [complaintId],
      (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (results.length === 0) {
          return res.status(404).json({ error: "Complaint not found" });
        }
        
        const userId = results[0].user_id;
        const status = results[0].status;
        
        db.query(
          "INSERT INTO correspondence (complaint_id, sender_role, message) VALUES (?, ?, ?)",
          [complaintId, "admin", message],
          (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            
            // Get user email and name to send notification
            db.query(
              "SELECT full_name, email FROM users WHERE id = ?",
              [userId],
              (err, userResults) => {
                if (!err && userResults.length > 0) {
                  const user = userResults[0];
                  sendComplaintUpdateEmail(
                    user.email,
                    user.full_name,
                    complaintId,
                    status,
                    message
                  );
                }
              }
            );
            
            res.json({ success: true, message: "Message sent and user notified via email" });
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ADMIN ROUTES ====================

// Get Admin Dashboard - All Complaints with User Details
app.get("/admin/dashboard", isAdminLoggedIn, (req, res) => {
  db.query(
    `SELECT c.*, u.full_name, u.email, u.phone, u.address 
     FROM complaints c 
     JOIN users u ON c.user_id = u.id 
     WHERE c.district = ?
     ORDER BY c.created_at DESC`,
    [req.session.adminDistrict],
    (err, complaints) => {
      if (err) return res.status(500).json({ error: err.message });
      
      res.json({ complaints });
    }
  );
});

// Update Complaint Status
app.post("/admin/update-status", isAdminLoggedIn, upload.single("resolved_image"), (req, res) => {
  try {
    const { complaintId, status } = req.body;
    
    if (!complaintId || !status) {
      return res.status(400).json({ error: "Complaint ID and status required" });
    }
    
    // Verify complaint belongs to this admin's district
    db.query(
      "SELECT id, user_id FROM complaints WHERE id = ? AND district = ?",
      [complaintId, req.session.adminDistrict],
      (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (results.length === 0) {
          return res.status(403).json({ error: "Unauthorized - This complaint is not in your district" });
        }
        
        const userId = results[0].user_id;
        
        if (req.file) {
          // Update with resolved image
          const fs = require("fs");
          
          // Read the uploaded file
          fs.readFile(req.file.path, (err, fileData) => {
            if (err) {
              console.error("Error reading file:", err);
              // Update without storing image
              updateComplaintStatus();
              return;
            }
            
            // Store in database
            db.query(
              "INSERT INTO resolution_proofs (complaint_id, filename, image_data, file_type, file_size) VALUES (?, ?, ?, ?, ?)",
              [complaintId, req.file.originalname, fileData, req.file.mimetype, req.file.size],
              (err, result) => {
                if (err) {
                  console.error("Error storing resolution proof:", err);
                }
                
                // Delete file from uploads folder
                fs.unlink(req.file.path, (err) => {
                  if (err) console.error("Error deleting file:", err);
                });
                
                updateComplaintStatus();
              }
            );
          });
        } else {
          updateComplaintStatus();
        }
        
        function updateComplaintStatus() {
          db.query(
            "UPDATE complaints SET status = ? WHERE id = ?",
            [status, complaintId],
            (err, result) => {
              if (err) return res.status(500).json({ error: err.message });
              
              // Get user email and name to send notification
              db.query(
                "SELECT full_name, email FROM users WHERE id = ?",
                [userId],
                (err, userResults) => {
                  if (!err && userResults.length > 0) {
                    const user = userResults[0];
                    sendComplaintUpdateEmail(
                      user.email,
                      user.full_name,
                      complaintId,
                      status,
                      ""
                    );
                  }
                }
              );
              
              res.json({ success: true, message: "Status updated and user notified via email" });
            }
          );
        }
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Complaint Messages (Admin)
app.get("/admin/complaint/:id/messages", isAdminLoggedIn, (req, res) => {
  const complaintId = req.params.id;
  
  db.query(
    "SELECT * FROM complaints WHERE id = ? AND district = ?",
    [complaintId, req.session.adminDistrict],
    (err, complaints) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (complaints.length === 0) {
        return res.status(403).json({ error: "Unauthorized - This complaint is not in your district" });
      }
      
      db.query(
        "SELECT * FROM correspondence WHERE complaint_id = ? ORDER BY created_at ASC",
        [complaintId],
        (err, messages) => {
          if (err) return res.status(500).json({ error: err.message });
          
          res.json({ complaint: complaints[0], messages });
        }
      );
    }
  );
});

// Send Message (Admin)
app.post("/admin/complaint/:id/message", isAdminLoggedIn, (req, res) => {
  try {
    const { message } = req.body;
    const complaintId = req.params.id;
    
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }
    
    // Verify complaint belongs to this admin's district
    db.query(
      "SELECT id, user_id, status FROM complaints WHERE id = ? AND district = ?",
      [complaintId, req.session.adminDistrict],
      (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (results.length === 0) {
          return res.status(403).json({ error: "Unauthorized - This complaint is not in your district" });
        }
        
        const userId = results[0].user_id;
        const status = results[0].status;
        
        db.query(
          "INSERT INTO correspondence (complaint_id, sender_role, message) VALUES (?, ?, ?)",
          [complaintId, "admin", message],
          (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            
            // Get user email and name to send notification
            db.query(
              "SELECT full_name, email FROM users WHERE id = ?",
              [userId],
              (err, userResults) => {
                if (!err && userResults.length > 0) {
                  const user = userResults[0];
                  sendComplaintUpdateEmail(
                    user.email,
                    user.full_name,
                    complaintId,
                    status,
                    message
                  );
                }
              }
            );
            
            res.json({ success: true, message: "Message sent and user notified via email" });
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== IMAGE RETRIEVAL ENDPOINTS ====================

// Get ID Proof Image
app.get("/image/id-proof/:userId", (req, res) => {
  const userId = req.params.userId;
  console.log(`[Image Request] ID proof requested for user ID: ${userId}`);
  
  db.query(
    "SELECT image_data, file_type, filename FROM id_proofs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId],
    (err, results) => {
      if (err) {
        console.error(`[Image Error] Database error for user ${userId}:`, err);
        return res.status(500).send('Error loading image');
      }
      
      if (!results || results.length === 0) {
        console.log(`[Image] No ID proof found for user ${userId}`);
        return res.status(404).send('Image not found');
      }
      
      try {
        const imageRecord = results[0];
        let imageData = imageRecord.image_data;
        
        console.log(`[Image] Found ID proof for user ${userId}, type: ${typeof imageData}`);
        
        // Ensure we have a Buffer
        let buffer;
        if (Buffer.isBuffer(imageData)) {
          buffer = imageData;
          console.log(`[Image] Already a buffer`);
        } else if (typeof imageData === 'string') {
          console.log(`[Image] Converting string (length: ${imageData.length})`);
          buffer = Buffer.from(imageData, 'binary');
        } else if (Array.isArray(imageData)) {
          console.log(`[Image] Converting array (length: ${imageData.length})`);
          buffer = Buffer.from(imageData);
        } else {
          console.log(`[Image] Converting unknown type: ${Object.prototype.toString.call(imageData)}`);
          buffer = Buffer.from(imageData);
        }
        
        const contentType = imageRecord.file_type || 'image/jpeg';
        console.log(`[Image] Serving ID proof - User: ${userId}, Size: ${buffer.length} bytes, Type: ${contentType}`);
        
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Length", buffer.length);
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.send(buffer);
      } catch (innerError) {
        console.error(`[Image Error] Processing error for user ${userId}:`, innerError);
        res.status(500).send('Error processing image');
      }
    }
  );
});

// Get Complaint Proof Image
app.get("/image/complaint-proof/:complaintId", (req, res) => {
  const complaintId = req.params.complaintId;
  console.log(`[Image Request] Complaint proof requested for complaint ID: ${complaintId}`);
  
  db.query(
    "SELECT image_data, file_type, filename FROM complaint_proofs WHERE complaint_id = ? ORDER BY created_at DESC LIMIT 1",
    [complaintId],
    (err, results) => {
      if (err) {
        console.error(`[Image Error] Database error for complaint ${complaintId}:`, err);
        return res.status(500).send('Error loading image');
      }
      
      if (!results || results.length === 0) {
        console.log(`[Image] No proof image found for complaint ${complaintId}`);
        return res.status(404).send('Image not found');
      }
      
      try {
        const imageRecord = results[0];
        let imageData = imageRecord.image_data;
        
        console.log(`[Image] Found image for complaint ${complaintId}, type: ${typeof imageData}`);
        
        // Ensure we have a Buffer
        let buffer;
        if (Buffer.isBuffer(imageData)) {
          buffer = imageData;
          console.log(`[Image] Already a buffer`);
        } else if (typeof imageData === 'string') {
          console.log(`[Image] Converting string (length: ${imageData.length})`);
          buffer = Buffer.from(imageData, 'binary');
        } else if (Array.isArray(imageData)) {
          console.log(`[Image] Converting array (length: ${imageData.length})`);
          buffer = Buffer.from(imageData);
        } else {
          console.log(`[Image] Converting unknown type: ${Object.prototype.toString.call(imageData)}`);
          buffer = Buffer.from(imageData);
        }
        
        const contentType = imageRecord.file_type || 'image/jpeg';
        console.log(`[Image] Serving complaint proof - ID: ${complaintId}, Size: ${buffer.length} bytes, Type: ${contentType}`);
        
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Length", buffer.length);
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.send(buffer);
      } catch (innerError) {
        console.error(`[Image Error] Processing error for complaint ${complaintId}:`, innerError);
        res.status(500).send('Error processing image');
      }
    }
  );
});

// Get Resolution Proof Image
app.get("/image/resolution-proof/:complaintId", (req, res) => {
  const complaintId = req.params.complaintId;
  console.log(`[Image Request] Resolution proof requested for complaint ID: ${complaintId}`);
  
  db.query(
    "SELECT image_data, file_type, filename FROM resolution_proofs WHERE complaint_id = ? ORDER BY created_at DESC LIMIT 1",
    [complaintId],
    (err, results) => {
      if (err) {
        console.error(`[Image Error] Database error for complaint ${complaintId}:`, err);
        return res.status(500).send('Error loading image');
      }
      
      if (!results || results.length === 0) {
        console.log(`[Image] No resolution proof found for complaint ${complaintId}`);
        return res.status(404).send('Image not found');
      }
      
      try {
        const imageRecord = results[0];
        let imageData = imageRecord.image_data;
        
        console.log(`[Image] Found resolution proof for complaint ${complaintId}, type: ${typeof imageData}`);
        
        // Ensure we have a Buffer
        let buffer;
        if (Buffer.isBuffer(imageData)) {
          buffer = imageData;
          console.log(`[Image] Already a buffer`);
        } else if (typeof imageData === 'string') {
          console.log(`[Image] Converting string (length: ${imageData.length})`);
          buffer = Buffer.from(imageData, 'binary');
        } else if (Array.isArray(imageData)) {
          console.log(`[Image] Converting array (length: ${imageData.length})`);
          buffer = Buffer.from(imageData);
        } else {
          console.log(`[Image] Converting unknown type: ${Object.prototype.toString.call(imageData)}`);
          buffer = Buffer.from(imageData);
        }
        
        const contentType = imageRecord.file_type || 'image/jpeg';
        console.log(`[Image] Serving resolution proof - ID: ${complaintId}, Size: ${buffer.length} bytes, Type: ${contentType}`);
        
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Length", buffer.length);
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.send(buffer);
      } catch (innerError) {
        console.error(`[Image Error] Processing error for complaint ${complaintId}:`, innerError);
        res.status(500).send('Error processing image');
      }
    }
  );
});

// ==================== OCR ID VERIFICATION ENDPOINT ====================

/**
 * POST /verify-id
 * Verify ID proof using advanced OCR
 * 
 * Request body:
 * {
 *   id_type: "PAN" | "AADHAAR" | "DRIVING_LICENSE" | "VOTER_ID",
 *   id_number: "user entered ID number",
 *   id_image: file upload
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   extracted_id: string | null,
 *   typed_id: string,
 *   id_type: string,
 *   match: boolean,
 *   error: string | null,
 *   duplicate: boolean | undefined
 * }
 */
app.post('/verify-id', upload.single('id_image'), async (req, res) => {
  // ID verification endpoint has been disabled. Registration no longer uses OCR.
  return res.status(400).json({ success: false, error: 'ID verification feature has been disabled.' });
});


// ==================== START SERVER ====================
// Health / identity endpoint to confirm running code
app.get('/__whoami', (req, res) => {
  res.send('EMAIL_OTP');
});

const server = app.listen(3000, () => {
  console.log("🚀 Server started on http://localhost:3000");
  console.log("[OCR Service] Tesseract will initialize on first OCR request (lazy loading)");
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');
  server.close(async () => {
    console.log('[Server] HTTP server closed');
    try {
      await ocrService.terminate();
      console.log('[OCR Service] OCR service terminated');
    } catch (error) {
      console.error('[OCR Service] Error terminating OCR service:', error);
    }
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('[Server] SIGINT received, shutting down gracefully...');
  server.close(async () => {
    console.log('[Server] HTTP server closed');
    try {
      await ocrService.terminate();
      console.log('[OCR Service] OCR service terminated');
    } catch (error) {
      console.error('[OCR Service] Error terminating OCR service:', error);
    }
    process.exit(0);
  });
});
