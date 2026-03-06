/**
 * ID Pattern Extractor Module
 * Extracts ID numbers from OCR text using regex patterns
 * Supports: PAN Card, Aadhaar Card, Driving License, Voter ID
 */

class IDPatternExtractor {
  constructor() {
    // Define regex patterns for each ID type
    this.patterns = {
      'PAN': {
        regex: /[A-Z]{5}[0-9]{4}[A-Z]/g,
        description: 'PAN Card (5 letters + 4 digits + 1 letter)',
        minLength: 10,
        maxLength: 10,
        priority: 1,
        validator: /^[A-Z]{5}[0-9]{4}[A-Z]$/
      },
      'AADHAAR': {
        regex: /\d{4}\s*\d{4}\s*\d{4}|\d{12}/g,
        description: 'Aadhaar Card (12 digits, may have spaces)',
        minLength: 12,
        maxLength: 14, // With spaces
        priority: 1,
        validator: /^\d{12}$/
      },
      'DRIVING_LICENSE': {
        regex: /[A-Z]{2}[0-9]{2}[0-9]{11}|[A-Z]{2}\d{13}[A-Z]?/g,
        description: 'Driving License (2 letters + 2 digits + 11 digits)',
        minLength: 15,
        maxLength: 16,
        priority: 1,
        validator: /^[A-Z]{2}[0-9]{13}$/
      },
      'VOTER_ID': {
        regex: /[A-Z]{3}[0-9]{7}/g,
        description: 'Voter ID (3 letters + 7 digits)',
        minLength: 10,
        maxLength: 10,
        priority: 1,
        validator: /^[A-Z]{3}[0-9]{7}$/
      }
    };
  }

  /**
   * Extract ID number from cleaned OCR text
   * @param {string} text - Cleaned OCR text
   * @param {string} idType - Type of ID (PAN, AADHAAR, DRIVING_LICENSE, VOTER_ID)
   * @returns {string|null} Extracted ID or null if not found
   */
  extractID(text, idType) {
    if (!text || !idType) {
      console.warn('[PatternExtractor] Missing text or idType');
      return null;
    }

    const normalizedType = this.normalizeIDType(idType);
    const pattern = this.patterns[normalizedType];

    if (!pattern) {
      console.error('[PatternExtractor] Unsupported ID type:', idType);
      return null;
    }

    console.log('[PatternExtractor] Extracting', normalizedType, 'from text length:', text.length);

    // Find all matches
    const matches = text.match(pattern.regex);

    if (!matches || matches.length === 0) {
      console.log('[PatternExtractor] No matches found for', normalizedType);
      return null;
    }

    console.log('[PatternExtractor] Found', matches.length, 'match(es):', matches);

    // Process matches to find the best one
    for (const match of matches) {
      const processed = this.processMatch(match, normalizedType);
      if (processed && this.validateID(processed, normalizedType)) {
        console.log('[PatternExtractor] Valid ID extracted:', processed);
        return processed;
      }
    }

    console.log('[PatternExtractor] No valid ID found among matches');
    return null;
  }

  /**
   * Extract all possible IDs from text
   * @param {string} text - Cleaned OCR text
   * @param {string} idType - Type of ID
   * @returns {string[]} Array of potential IDs
   */
  extractAllMatches(text, idType) {
    if (!text || !idType) return [];

    const normalizedType = this.normalizeIDType(idType);
    const pattern = this.patterns[normalizedType];

    if (!pattern) return [];

    const matches = text.match(pattern.regex) || [];
    
    return matches
      .map(match => this.processMatch(match, normalizedType))
      .filter(Boolean);
  }

  /**
   * Process a regex match to clean and normalize it
   * @param {string} match - Regex match
   * @param {string} idType - Type of ID
   * @returns {string} Processed match
   */
  processMatch(match, idType) {
    if (!match) return null;

    let processed = match.trim();

    switch (idType) {
      case 'AADHAAR':
        // Remove spaces from Aadhaar number
        processed = processed.replace(/\s+/g, '');
        // Ensure it's 12 digits
        processed = processed.replace(/[^0-9]/g, '');
        if (processed.length === 12) {
          return processed;
        }
        break;

      case 'PAN':
        // Remove spaces and special chars
        processed = processed.replace(/[^A-Z0-9]/g, '').toUpperCase();
        if (processed.length === 10) {
          return processed;
        }
        break;

      case 'DRIVING_LICENSE':
        // Remove spaces and special chars except hyphens (sometimes used as separators)
        processed = processed.replace(/\s+/g, '').toUpperCase();
        processed = processed.replace(/[^A-Z0-9]/g, '');
        if (processed.length >= 15) {
          return processed.substring(0, 15); // Standard DL length
        }
        break;

      case 'VOTER_ID':
        // Remove spaces and special chars
        processed = processed.replace(/[^A-Z0-9]/g, '').toUpperCase();
        if (processed.length === 10) {
          return processed;
        }
        break;
    }

    return null;
  }

  /**
   * Validate if extracted ID matches the expected format
   * @param {string} id - ID to validate
   * @param {string} idType - Type of ID
   * @returns {boolean} Whether ID is valid
   */
  validateID(id, idType) {
    if (!id) return false;

    const pattern = this.patterns[idType];
    if (!pattern) return false;

    // Check length
    if (id.length < pattern.minLength || id.length > pattern.maxLength) {
      console.log('[PatternExtractor] Invalid length for', idType, ':', id.length);
      return false;
    }

    // Check format with validator regex
    const isValid = pattern.validator.test(id);
    console.log('[PatternExtractor] Validation for', idType, ':', isValid);

    return isValid;
  }

  /**
   * Normalize ID type to standard format
   * @param {string} idType - Input ID type (may be in different formats)
   * @returns {string} Normalized ID type
   */
  normalizeIDType(idType) {
    if (!idType) return null;

    const normalized = idType.toUpperCase().replace(/\s+/g, '_');

    // Handle various input formats
    const typeMap = {
      'PAN': 'PAN',
      'AADHAAR': 'AADHAAR',
      'AADHAR': 'AADHAAR',
      'AADH': 'AADHAAR',
      'DL': 'DRIVING_LICENSE',
      'DRIVING_LICENSE': 'DRIVING_LICENSE',
      'DRIVING_LICENCE': 'DRIVING_LICENSE',
      'VOTER_ID': 'VOTER_ID',
      'VOTER': 'VOTER_ID',
      'EPIC': 'VOTER_ID'
    };

    return typeMap[normalized] || null;
  }

  /**
   * Get regex pattern for a specific ID type
   * @param {string} idType - Type of ID
   * @returns {RegExp|null} Regex pattern
   */
  getPattern(idType) {
    const normalized = this.normalizeIDType(idType);
    return normalized ? this.patterns[normalized]?.regex : null;
  }

  /**
   * Get pattern description
   * @param {string} idType - Type of ID
   * @returns {string} Description of the pattern
   */
  getPatternDescription(idType) {
    const normalized = this.normalizeIDType(idType);
    return normalized ? this.patterns[normalized]?.description : null;
  }

  /**
   * Compare extracted ID with user-entered ID
   * @param {string} extractedID - ID extracted from OCR
   * @param {string} typedID - ID entered by user
   * @param {string} idType - Type of ID
   * @returns {boolean} Whether IDs match
   */
  compareIDs(extractedID, typedID, idType) {
    if (!extractedID || !typedID) {
      console.log('[PatternExtractor] Missing extracted or typed ID');
      return false;
    }

    const normalized = this.normalizeIDType(idType);

    // Normalize both IDs for comparison
    let extracted = extractedID.replace(/\s+/g, '').toUpperCase();
    let typed = typedID.replace(/\s+/g, '').toUpperCase();

    // Remove non-alphanumeric for comparison
    extracted = extracted.replace(/[^A-Z0-9]/g, '');
    typed = typed.replace(/[^A-Z0-9]/g, '');

    console.log('[PatternExtractor] Comparing:');
    console.log('  Extracted:', extracted);
    console.log('  Typed:', typed);

    switch (normalized) {
      case 'AADHAAR':
        // For Aadhaar, MUST match the COMPLETE 12 digits
        // Privacy note: Only last 4 digits are stored in DB, but verification requires full match
        // This ensures the user is providing their correct Aadhaar
        if (extracted.length !== 12 || typed.length !== 12) {
          console.log('[PatternExtractor] Aadhaar mismatch - invalid lengths:', extracted.length, 'vs', typed.length);
          return false;
        }
        const aadharMatch = extracted === typed;
        console.log('[PatternExtractor] Aadhaar full match:', extracted, 'vs', typed, '=', aadharMatch);
        return aadharMatch;

      case 'PAN':
      case 'DRIVING_LICENSE':
      case 'VOTER_ID':
        // For other IDs, require exact match
        // Validate both are properly formatted before comparing
        if (!this.validateID(extracted, normalized) || !this.validateID(typed, normalized)) {
          console.log('[PatternExtractor] One or both IDs failed format validation');
          return false;
        }
        const exactMatch = extracted === typed;
        console.log('[PatternExtractor] Exact match:', extracted, 'vs', typed, '=', exactMatch);
        return exactMatch;

      default:
        console.log('[PatternExtractor] Unknown ID type:', normalized);
        return false;
    }
  }

  /**
   * Get list of supported ID types
   * @returns {string[]} Array of supported ID types
   */
  getSupportedTypes() {
    return Object.keys(this.patterns).map(type => type.replace(/_/g, ' '));
  }

  /**
   * Detect ID type from text (auto-detection)
   * @param {string} text - Cleaned OCR text
   * @returns {string|null} Detected ID type or null
   */
  detectIDType(text) {
    if (!text) return null;

    const textUpper = text.toUpperCase();

    // Try each pattern and return the first match
    for (const [type, pattern] of Object.entries(this.patterns)) {
      if (pattern.regex.test(textUpper)) {
        console.log('[PatternExtractor] Detected ID type:', type);
        return type.replace(/_/g, ' ');
      }
    }

    console.log('[PatternExtractor] Could not detect ID type');
    return null;
  }
}

module.exports = new IDPatternExtractor();