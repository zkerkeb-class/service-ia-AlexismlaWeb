const path = require('path');

/**
 * Input sanitization utilities for IA service
 */

/**
 * Sanitizes user input by removing dangerous characters
 * @param {string} input - The input to sanitize
 * @returns {string} - Sanitized input
 */
function sanitize(input) {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove dangerous characters and patterns
  return input
    .replace(/[<>]/g, '') // Remove < and >
    .replace(/\.\./g, '') // Remove path traversal
    .replace(/[\/\\]/g, '') // Remove slashes
    .replace(/[;&|`$]/g, '') // Remove shell injection chars
    .trim();
}

/**
 * Validates and sanitizes a filename
 * @param {string} filename - The filename to validate
 * @returns {string|null} - Sanitized filename or null if invalid
 */
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return null;
  }

  // First sanitize the entire filename to remove path traversal
  const sanitizedFullName = sanitize(filename);
  
  // Use path to extract extension and name from the sanitized filename
  const ext = path.extname(sanitizedFullName);
  const base = path.basename(sanitizedFullName, ext);
  
  // Check if filename is valid after sanitization
  if (!base || base.length === 0) {
    return null;
  }

  // Add timestamp to ensure uniqueness
  const timestamp = Date.now();
  
  // If there's an extension, append timestamp after the extension
  // If no extension, add .txt extension before timestamp
  if (ext && ext.length > 0) {
    return `${base}${ext}_${timestamp}`;
  } else {
    return `${base}_${timestamp}.txt`;
  }
}

/**
 * Validates if input contains safe content
 * @param {string} input - The input to validate
 * @returns {boolean} - True if input is safe
 */
function isSafeInput(input) {
  if (!input || typeof input !== 'string') {
    return false;
  }

  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /\.\./,
    /[<>]/,
    /[;&|`$]/
  ];

  return !dangerousPatterns.some(pattern => pattern.test(input));
}

module.exports = {
  sanitize,
  sanitizeFilename,
  isSafeInput
};
