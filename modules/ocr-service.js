/**
 * OCR Verification Service
 * Main service that orchestrates all OCR components for Indian ID verification
 * 
 * Flow:
 * 1. Preprocess image
 * 2. Extract text via Tesseract OCR
 * 3. Clean extracted text
 * 4. Extract ID number using regex
 * 5. Compare with user-entered ID
 * 6. Check database for duplicate IDs
 */

const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');
const imagePreprocessor = require('./image-preprocessor');
const textCleaner = require('./ocr-text-cleaner');
const patternExtractor = require('./id-pattern-extractor');

class OCRVerificationService {
  constructor(database = null) {
    this.db = database; // MySQL connection pool (optional, can be injected)
    this.worker = null;
    this.isInitialized = false;
    this.initPromise = null;
  }

  /**
   * Initialize Tesseract worker
   * Lazy initialization - only initialize when needed
   * @returns {Promise<void>}
   */
  async initialize() {
    // If already initialized, skip
    if (this.isInitialized && this.worker) {
      return;
    }

    // If already initializing, return existing promise
    if (this.initPromise) {
      return this.initPromise;
    }

    // Start initialization
    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  async _doInitialize() {
    try {
      console.log('[OCRService] Initializing Tesseract worker...');
      
      // For Tesseract.js v7, use the worker directly
      this.worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing') {
            console.log('[OCRService] OCR Progress:', Math.round(m.progress * 100) + '%');
          }
        }
      });

      console.log('[OCRService] ✓ Tesseract worker initialized successfully');
      this.isInitialized = true;
      this.initPromise = null;
    } catch (error) {
      console.error('[OCRService] ✗ Failed to initialize Tesseract:', error.message);
      this.initPromise = null;
      throw error;
    }
  }

  /**
   * Terminate Tesseract worker
   * Call this at application shutdown
   * @returns {Promise<void>}
   */
  async terminate() {
    if (this.worker) {
      try {
        await this.worker.terminate();
        this.isInitialized = false;
        console.log('[OCRService] Tesseract worker terminated');
      } catch (error) {
        console.error('[OCRService] Error terminating worker:', error);
      }
    }
  }

  /**
   * Main verification function
   * @param {string} imagePath - Path to uploaded ID image
   * @param {string} idType - Type of ID (PAN, AADHAAR, DRIVING_LICENSE, VOTER_ID)
   * @param {string} typedID - ID number entered by user
   * @returns {Promise<Object>} Verification result
   */
  async verifyID(imagePath, idType, typedID) {
    console.log('[OCRService] Starting ID verification');
    console.log('[OCRService] ID Type:', idType, '| Typed ID:', typedID);

    let processedImagePath = null;

    try {
      // Step 1: Validate inputs
      if (!imagePath || !fs.existsSync(imagePath)) {
        throw new Error('Image file not found');
      }

      if (!idType || !typedID) {
        throw new Error('ID type and number are required');
      }

      // Step 2: Preprocess image
      console.log('[OCRService] Step 1: Image preprocessing...');
      processedImagePath = imagePath + '_processed.png';
      await imagePreprocessor.preprocessAdaptive(imagePath, processedImagePath);

      // Step 3: Extract text via OCR
      console.log('[OCRService] Step 2: Running OCR...');
      const extractedText = await this.extractTextOCR(processedImagePath);

      // Step 4: Clean text
      console.log('[OCRService] Step 3: Cleaning extracted text...');
      const cleanedText = textCleaner.cleanText(extractedText, idType);

      // Step 5: Extract ID number
      console.log('[OCRService] Step 4: Extracting ID number...');
      const extractedID = patternExtractor.extractID(cleanedText, idType);

      if (!extractedID) {
        return {
          success: false,
          error: 'Could not extract ID number from image. Please ensure the image is clear and readable.',
          extracted_id: null,
          typed_id: typedID,
          id_type: idType,
          match: false,
          extracted_text: cleanedText.substring(0, 500) // Return partial text for debugging
        };
      }

      // Step 6: Compare IDs
      console.log('[OCRService] Step 5: Comparing IDs...');
      const isMatch = patternExtractor.compareIDs(extractedID, typedID, idType);

      if (!isMatch) {
        return {
          success: true,
          error: 'ID number does not match uploaded proof',
          extracted_id: extractedID,
          typed_id: typedID,
          id_type: idType,
          match: false
        };
      }

      // Step 7: Check database for duplicates (if DB connection available)
      console.log('[OCRService] Step 6: Checking for duplicate IDs...');
      const isDuplicate = await this.checkDuplicateID(extractedID, idType);

      if (isDuplicate) {
        return {
          success: true,
          error: 'This ID is already registered. Please login or use a different ID.',
          extracted_id: extractedID,
          typed_id: typedID,
          id_type: idType,
          match: true,
          duplicate: true
        };
      }

      // Success!
      console.log('[OCRService] ✓ ID verification successful');
      return {
        success: true,
        error: null,
        extracted_id: extractedID,
        typed_id: typedID,
        id_type: idType,
        match: true,
        duplicate: false
      };

    } catch (error) {
      console.error('[OCRService] Verification failed:', error);
      return {
        success: false,
        error: 'OCR verification failed: ' + error.message,
        extracted_id: null,
        typed_id: typedID,
        id_type: idType,
        match: false
      };
    } finally {
      // Cleanup
      if (processedImagePath) {
        imagePreprocessor.cleanupFile(processedImagePath);
      }
    }
  }

  /**
   * Extract text from image using Tesseract OCR
   * @param {string} imagePath - Path to image
   * @returns {Promise<string>} Extracted text
   */
  async extractTextOCR(imagePath) {
    try {
      // Ensure worker is initialized
      if (!this.isInitialized || !this.worker) {
        console.log('[OCRService] Worker not initialized, initializing now...');
        await this.initialize();
      }

      console.log('[OCRService] Running Tesseract on image:', imagePath);
      const { data: { text } } = await this.worker.recognize(imagePath);
      
      const extractedText = text || '';

      console.log('[OCRService] OCR text length:', extractedText.length);
      console.log('[OCRService] OCR text (first 200 chars):', extractedText.substring(0, 200));

      return extractedText;

    } catch (error) {
      console.error('[OCRService] OCR extraction failed:', error.message);
      throw error;
    }
  }

  /**
   * Check if ID already exists in database
   * @param {string} id - ID to check
   * @param {string} idType - Type of ID
   * @returns {Promise<boolean>} True if ID exists
   */
  async checkDuplicateID(id, idType) {
    if (!this.db) {
      console.warn('[OCRService] Database not available, skipping duplicate check');
      return false;
    }

    try {
      return new Promise((resolve, reject) => {
        const query = 'SELECT id FROM users WHERE id_proof_number = ? AND id_proof_type = ? LIMIT 1';
        
        this.db.query(query, [id, idType], (err, results) => {
          if (err) {
            console.error('[OCRService] Database error:', err);
            reject(err);
          } else {
            const isDuplicate = results && results.length > 0;
            console.log('[OCRService] Duplicate check result:', isDuplicate ? 'Found' : 'Not found');
            resolve(isDuplicate);
          }
        });
      });
    } catch (error) {
      console.error('[OCRService] Duplicate ID check failed:', error);
      // Don't fail verification if DB check fails
      return false;
    }
  }

  /**
   * Batch verify multiple IDs (for testing)
   * @param {Array} verifications - Array of {imagePath, idType, typedID}
   * @returns {Promise<Array>} Array of verification results
   */
  async batchVerify(verifications) {
    const results = [];

    for (const verification of verifications) {
      try {
        const result = await this.verifyID(
          verification.imagePath,
          verification.idType,
          verification.typedID
        );
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Get supported ID types
   * @returns {string[]} Array of supported ID types
   */
  getSupportedIDTypes() {
    return patternExtractor.getSupportedTypes();
  }

  /**
   * Set database connection
   * @param {Object} dbConnection - MySQL connection pool
   */
  setDatabase(dbConnection) {
    this.db = dbConnection;
    console.log('[OCRService] Database connection set');
  }
}

module.exports = OCRVerificationService;