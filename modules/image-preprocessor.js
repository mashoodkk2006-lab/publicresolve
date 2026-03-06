/**
 * Image Preprocessing Module for OCR
 * Applies various image enhancement techniques to improve OCR accuracy
 * 
 * Techniques used:
 * - Grayscale conversion
 * - Contrast enhancement
 * - Adaptive thresholding (via brightness/contrast)
 * - Noise reduction (via blur and sharpen)
 * - Image resizing for optimal OCR
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

class ImagePreprocessor {
  constructor() {
    this.maxWidth = 1600; // Maximum width for OCR optimization
    this.minWidth = 400;  // Minimum width for OCR accuracy
  }

  /**
   * Main preprocessing function that applies all enhancements
   * @param {string} inputPath - Path to input image
   * @param {string} outputPath - Path to save preprocessed image
   * @returns {Promise<string>} Path to preprocessed image
   */
  async preprocess(inputPath, outputPath) {
    try {
      console.log('[ImagePreprocessor] Starting image preprocessing:', inputPath);

      // Load image metadata
      const metadata = await sharp(inputPath).metadata();
      console.log('[ImagePreprocessor] Image metadata:', {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format
      });

      // Calculate optimal dimensions
      const targetWidth = this.calculateOptimalWidth(metadata.width);

      // Apply preprocessing pipeline
      let image = sharp(inputPath);

      // 1. Convert to grayscale
      image = image.grayscale();
      console.log('[ImagePreprocessor] Applied grayscale conversion');

      // 2. Resize image for better OCR
      if (metadata.width !== targetWidth) {
        image = image.resize(targetWidth, null, {
          withoutEnlargement: false,
          kernel: sharp.kernel.lanczos3
        });
        console.log('[ImagePreprocessor] Resized to width:', targetWidth);
      }

      // 3. Enhance contrast and normalize
      image = image
        .normalize() // Normalize image (adjust min/max to full range)
        .modulate({
          brightness: 1.0,  // Brightness multiplier
          saturation: 1.0,  // Keep some saturation info
          hue: 0,           // Keep hue
          lightness: 1.1    // Slightly increase lightness
        });
      console.log('[ImagePreprocessor] Applied contrast enhancement');

      // 4. Apply sharpening to improve text clarity
      image = image.sharpen({
        sigma: 1.5  // Sharpening radius
      });
      console.log('[ImagePreprocessor] Applied sharpening');

      // 5. Apply slight median filter to reduce noise while preserving edges
      // (Using threshold as alternative to median - effective for text)
      image = image.threshold(128); // Binary threshold for clearer text
      console.log('[ImagePreprocessor] Applied threshold');

      // 6. Convert to PNG for better OCR compatibility
      image = image.png();

      // 7. Save preprocessed image
      await image.toFile(outputPath);
      console.log('[ImagePreprocessor] Preprocessing complete:', outputPath);

      return outputPath;

    } catch (error) {
      console.error('[ImagePreprocessor] Preprocessing failed:', error);
      throw error;
    }
  }

  /**
   * Calculate optimal width based on input image width
   * @param {number} currentWidth - Current image width
   * @returns {number} Optimal width for OCR
   */
  calculateOptimalWidth(currentWidth) {
    // If image is too small, upscale it
    if (currentWidth < this.minWidth) {
      return this.minWidth;
    }
    // If image is too large, downscale it
    if (currentWidth > this.maxWidth) {
      return this.maxWidth;
    }
    return currentWidth;
  }

  /**
   * Advanced preprocessing with multi-step enhancement
   * Use this for challenging/low-quality images
   * @param {string} inputPath - Path to input image
   * @param {string} outputPath - Path to save preprocessed image
   * @returns {Promise<string>} Path to preprocessed image
   */
  async preprocessAdvanced(inputPath, outputPath) {
    try {
      console.log('[ImagePreprocessor] Starting advanced preprocessing:', inputPath);

      const metadata = await sharp(inputPath).metadata();
      const targetWidth = this.calculateOptimalWidth(metadata.width);

      // Step 1: Initial cleanup and resize
      let buffer = await sharp(inputPath)
        .resize(targetWidth, null, { withoutEnlargement: false, kernel: sharp.kernel.lanczos3 })
        .greyscale()
        .toBuffer();

      // Step 2: Enhance contrast aggressively
      buffer = await sharp(buffer)
        .normalize()
        .modulate({ brightness: 1.1, lightness: 1.2 })
        .toBuffer();

      // Step 3: Sharpen for better text definition
      buffer = await sharp(buffer)
        .sharpen({ sigma: 2.5 })
        .toBuffer();

      // Step 4: Apply threshold for binary image (black text on white background)
      buffer = await sharp(buffer)
        .threshold(140) // Fine-tuned threshold for Indian ID cards
        .toBuffer();

      // Step 5: Save result
      await sharp(buffer).png().toFile(outputPath);
      console.log('[ImagePreprocessor] Advanced preprocessing complete:', outputPath);

      return outputPath;

    } catch (error) {
      console.error('[ImagePreprocessor] Advanced preprocessing failed:', error);
      throw error;
    }
  }

  /**
   * Apply selective enhancement based on image quality
   * @param {string} inputPath - Path to input image
   * @param {string} outputPath - Path to save preprocessed image
   * @returns {Promise<string>} Path to preprocessed image
   */
  async preprocessAdaptive(inputPath, outputPath) {
    try {
      console.log('[ImagePreprocessor] Starting adaptive preprocessing:', inputPath);

      // Analyze image to determine preprocessing strategy
      const metadata = await sharp(inputPath).metadata();
      
      // Use advanced preprocessing for high-resolution images
      if (metadata.width > 1200) {
        console.log('[ImagePreprocessor] Using advanced preprocessing for high-res image');
        return await this.preprocessAdvanced(inputPath, outputPath);
      } else {
        console.log('[ImagePreprocessor] Using standard preprocessing for normal-res image');
        return await this.preprocess(inputPath, outputPath);
      }

    } catch (error) {
      console.error('[ImagePreprocessor] Adaptive preprocessing failed:', error);
      throw error;
    }
  }

  /**
   * Clean up temporary preprocessed image files
   * @param {string} filePath - Path to file to delete
   */
  cleanupFile(filePath) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('[ImagePreprocessor] Cleaned up:', filePath);
      }
    } catch (error) {
      console.warn('[ImagePreprocessor] Failed to cleanup file:', error);
    }
  }
}

module.exports = new ImagePreprocessor();