/**
 * OCR Text Cleaner Module
 * Cleans and corrects OCR extracted text for better ID number detection
 * 
 * Handles:
 * - Text normalization (uppercase, remove special chars)
 * - Common OCR misreads correction
 * - Whitespace normalization
 * - Special character handling for different ID types
 */

class OCRTextCleaner {
  constructor() {
    // Mapping of common OCR misreads for Indian ID cards
    this.ocrMisreads = {
      'O': '0',  // Letter O to Zero
      'o': '0',  // lowercase o to zero
      'I': '1',  // Letter I to One
      'i': '1',  // lowercase i to one
      'l': '1',  // lowercase L to one
      'Z': '2',  // Letter Z to Two
      'z': '2',  // lowercase z to two
      'S': '5',  // Letter S to Five
      's': '5',  // lowercase s to five
      'B': '8',  // Letter B to Eight
      'G': '9',  // Letter G to Nine (sometimes)
      'T': '7',  // Letter T to Seven (context dependent)
    };

    // Special characters often misread in OCR
    this.specialCharReplacements = {
      '—': '-',   // Em dash to hyphen
      '–': '-',   // En dash to hyphen
      '_': '-',   // Underscore to hyphen
      '`': "'",   // Backtick to apostrophe
      '\u2018': "'",  // Left single quotes to apostrophe
      '\u2019': "'",  // Right single quote to apostrophe
      '\u201C': '"',  // Left double quote to straight quote
      '\u201D': '"',  // Right double quote to straight quote
    };
  }

  /**
   * Main text cleaning function
   * @param {string} text - Raw OCR extracted text
   * @param {string} idType - Type of ID (PAN, Aadhaar, Driving License, Voter ID)
   * @returns {string} Cleaned text
   */
  cleanText(text, idType = 'general') {
    if (!text || typeof text !== 'string') {
      return '';
    }

    // Chain cleaning operations
    let cleaned = text;
    
    // 1. Handle special characters first
    cleaned = this.replaceSpecialChars(cleaned);
    console.log('[TextCleaner] After special char replacement:', cleaned.substring(0, 100));

    // 2. Correct common OCR misreads
    cleaned = this.correctOCRMisreads(cleaned);
    console.log('[TextCleaner] After OCR misread correction:', cleaned.substring(0, 100));

    // 3. Normalize whitespace
    cleaned = this.normalizeWhitespace(cleaned);
    console.log('[TextCleaner] After whitespace normalization:', cleaned.substring(0, 100));

    // 4. Remove unwanted characters based on ID type
    cleaned = this.removeUnwantedChars(cleaned, idType);
    console.log('[TextCleaner] After character removal:', cleaned.substring(0, 100));

    // 5. Convert to uppercase for ID matching
    cleaned = cleaned.toUpperCase();
    console.log('[TextCleaner] Final cleaned text:', cleaned.substring(0, 100));

    return cleaned;
  }

  /**
   * Replace special characters that commonly appear in OCR
   * @param {string} text - Input text
   * @returns {string} Text with special chars replaced
   */
  replaceSpecialChars(text) {
    let result = text;
    
    for (const [char, replacement] of Object.entries(this.specialCharReplacements)) {
      result = result.split(char).join(replacement);
    }

    return result;
  }

  /**
   * Correct common OCR misreads
   * @param {string} text - Input text
   * @returns {string} Text with misreads corrected
   */
  correctOCRMisreads(text) {
    let result = text;
    
    // Smart correction - only fix obvious misreads
    // For numbers, replace letters that look similar
    result = result.replace(/[Oo]/g, '0');  // O/o to 0
    result = result.replace(/[Il]/g, '1');  // I/l to 1
    result = result.replace(/[Zz]/g, '2');  // Z/z to 2
    result = result.replace(/S/g, '5');     // S to 5
    result = result.replace(/B/g, '8');     // B to 8
    result = result.replace(/G/g, '9');     // G to 9 (in number context)

    return result;
  }

  /**
   * Normalize whitespace and newlines
   * @param {string} text - Input text
   * @returns {string} Text with normalized whitespace
   */
  normalizeWhitespace(text) {
    // Replace multiple spaces with single space
    let result = text.replace(/\s+/g, ' ');
    
    // Remove spaces from number sequences
    result = result.replace(/(\d)\s+(?=\d)/g, '$1');
    
    // Trim leading and trailing whitespace
    result = result.trim();

    return result;
  }

  /**
   * Remove unwanted characters based on ID type
   * @param {string} text - Input text
   * @param {string} idType - Type of ID
   * @returns {string} Cleaned text
   */
  removeUnwantedChars(text, idType = 'general') {
    let result = text;

    switch (idType) {
      case 'PAN':
      case 'Voter ID':
      case 'VOTER':
        // Keep only alphanumeric
        result = result.replace(/[^A-Z0-9]/g, '');
        break;

      case 'Aadhaar':
      case 'AADHAAR':
        // Keep only digits and spaces
        result = result.replace(/[^0-9\s]/g, '');
        break;

      case 'Driving License':
      case 'DL':
        // Keep alphanumeric and common separators
        result = result.replace(/[^A-Z0-9\-/]/g, '');
        break;

      default:
        // Generic: keep alphanumeric, spaces, and common separators
        result = result.replace(/[^A-Z0-9\s\-/]/g, '');
    }

    return result;
  }

  /**
   * Extract numbers from text
   * @param {string} text - Input text
   * @returns {string} Text containing only numbers
   */
  extractNumbers(text) {
    return text.replace(/[^0-9]/g, '');
  }

  /**
   * Extract alphanumeric characters
   * @param {string} text - Input text
   * @returns {string} Text with only alphanumeric chars
   */
  extractAlphanumeric(text) {
    return text.replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Normalize ID number for comparison
   * Handles different spacing formats
   * @param {string} id - ID number
   * @param {string} idType - Type of ID
   * @returns {string} Normalized ID
   */
  normalizeForComparison(id, idType) {
    if (!id) return '';

    let normalized = id.toString().trim().toUpperCase();

    // Remove all spaces
    normalized = normalized.replace(/\s+/g, '');

    // Handle type-specific normalization
    if (idType === 'Aadhaar' || idType === 'AADHAAR') {
      // For Aadhaar, keep only the last 4 digits for comparison
      const digits = normalized.replace(/[^0-9]/g, '');
      return digits.slice(-4); // Last 4 digits
    }

    if (idType === 'PAN' || idType === 'Voter ID' || idType === 'VOTER') {
      // Keep only alphanumeric
      normalized = normalized.replace(/[^A-Z0-9]/g, '');
    }

    if (idType === 'Driving License' || idType === 'DL') {
      // Remove hyphens for comparison
      normalized = normalized.replace(/[-\/]/g, '');
    }

    return normalized;
  }

  /**
   * Validate if text looks like an ID number section
   * @param {string} text - Text to validate
   * @param {string} idType - Type of ID
   * @returns {boolean} Whether text looks valid for ID type
   */
  validateFormatLike(text, idType) {
    if (!text) return false;

    const clean = text.replace(/\s+/g, '').toUpperCase();

    switch (idType) {
      case 'PAN':
        // Should have letters and numbers mixed
        return /[A-Z]/.test(clean) && /[0-9]/.test(clean);

      case 'Aadhaar':
      case 'AADHAAR':
        // Should be mostly numbers
        return /^\d{8,}$/.test(clean.replace(/[^0-9]/g, ''));

      case 'Driving License':
      case 'DL':
        // Should have at least 2 letters followed by numbers
        return /^[A-Z]{2}[0-9]+/.test(clean);

      case 'Voter ID':
      case 'VOTER':
        // Should start with 3 letters followed by numbers
        return /^[A-Z]{3}[0-9]+/.test(clean);

      default:
        return clean.length >= 8; // Minimum ID length
    }
  }

  /**
   * Extract potential ID candidates from text
   * Returns the parts of text that might contain IDs
   * @param {string} text - Raw OCR text
   * @returns {string[]} Array of potential ID sections
   */
  extractIDCandidates(text) {
    if (!text) return [];

    const cleaned = text.toUpperCase();
    
    // Split by common delimiters and whitespace
    const candidates = cleaned.split(/[\n\r\s]{2,}/).filter(line => line.length > 5);
    
    // Also try to find continuous alphanumeric sequences
    const matches = cleaned.match(/[A-Z0-9]{8,}/g) || [];

    return [...new Set([...candidates, ...matches])]; // Remove duplicates
  }
}

module.exports = new OCRTextCleaner();