/**
 * StayFlow Centralized Government ID Document & Identification Number Validation Utility
 * Enforces mandatory ID number entry and document-specific format validation across all hotel modules.
 */

export const ID_DOC_TYPES = [
  'Aadhaar Card',
  'PAN Card',
  'Passport',
  'Driving Licence',
  'Voter ID',
  'Others'
];

/**
 * Returns dynamic UI label, placeholder, hint, and example for the selected document type.
 */
export function getExpectedFormatInfo(docType) {
  const norm = (docType || '').toLowerCase().trim();

  if (norm.includes('aadhaar')) {
    return {
      label: 'Aadhaar Number',
      placeholder: '1234 5678 9012',
      example: '123456789012',
      hint: 'Aadhaar number must contain exactly 12 numeric digits.',
      maxLength: 14 // allows spaces/hyphens while typing
    };
  }

  if (norm.includes('pan')) {
    return {
      label: 'PAN Number',
      placeholder: 'ABCDE1234F',
      example: 'ABCDE1234F',
      hint: '5 letters, 4 digits, 1 letter (e.g., ABCDE1234F).',
      maxLength: 10
    };
  }

  if (norm.includes('passport')) {
    return {
      label: 'Passport Number',
      placeholder: 'A1234567',
      example: 'A1234567',
      hint: '1 uppercase letter followed by 7 digits (e.g., A1234567).',
      maxLength: 9
    };
  }

  if (norm.includes('driv') || norm === 'dl') {
    return {
      label: 'Driving Licence Number',
      placeholder: 'TN01 20200012345',
      example: 'TN01 20200012345',
      hint: 'Valid Indian Driving Licence number (e.g., TN01 20200012345).',
      maxLength: 18
    };
  }

  if (norm.includes('voter') || norm.includes('epic') || norm.includes('election')) {
    return {
      label: 'Voter ID Number',
      placeholder: 'ABC1234567',
      example: 'ABC1234567',
      hint: '3 uppercase letters followed by 7 digits (e.g., ABC1234567).',
      maxLength: 10
    };
  }

  return {
    label: 'ID Number',
    placeholder: 'Enter government/photo ID number',
    example: 'ID12345678',
    hint: 'Mandatory government-issued identification number.',
    maxLength: 35
  };
}

/**
 * Validates the ID Number against the structure corresponding to the selected document type.
 * Returns { valid: boolean, error?: string, cleanValue?: string, fullFormatted?: string }
 */
export function validateIdNumber(docType, rawIdNumber, customSpecifyType = '') {
  if (!docType || !String(docType).trim()) {
    return { valid: false, error: 'ID document type is required.' };
  }

  const normType = String(docType).toLowerCase().trim();

  // If "Others" is selected, custom specification is mandatory
  if (normType === 'others' || normType === 'other id' || normType === 'other photo id') {
    if (!customSpecifyType || !customSpecifyType.trim()) {
      return { valid: false, error: 'Specify ID Type is mandatory when Others is selected. Please enter the ID type.' };
    }
  }

  // ID Number is mandatory across all document types
  if (!rawIdNumber || !String(rawIdNumber).trim()) {
    return { valid: false, error: 'ID Number is required.' };
  }

  const idVal = String(rawIdNumber).trim();

  // 1. Aadhaar Card: Exactly 12 numeric digits
  if (normType.includes('aadhaar')) {
    const clean = idVal.replace(/[\s-]/g, '');
    if (!/^\d+$/.test(clean)) {
      return { valid: false, error: 'Aadhaar number must contain numeric digits only.' };
    }
    if (clean.length !== 12 || !/^[0-9]{12}$/.test(clean)) {
      return { valid: false, error: 'Aadhaar number must contain exactly 12 digits.' };
    }
    return { valid: true, cleanValue: clean, formatted: clean, fullFormatted: `Aadhaar Card: ${clean}` };
  }

  // 2. PAN Card: 5 letters + 4 digits + 1 letter (10 characters)
  if (normType.includes('pan')) {
    const clean = idVal.replace(/[\s-]/g, '').toUpperCase();
    if (clean.length !== 10 || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(clean)) {
      return { valid: false, error: 'Enter a valid PAN number (e.g., ABCDE1234F).' };
    }
    return { valid: true, cleanValue: clean, formatted: clean, fullFormatted: `PAN Card: ${clean}` };
  }

  // 3. Passport: 1 uppercase letter followed by 7 digits (Indian) or standard 6-9 alphanumeric
  if (normType.includes('passport')) {
    const clean = idVal.replace(/[\s-]/g, '').toUpperCase();
    // Indian Passport format (1 letter + 7 digits)
    if (/^[A-Z][0-9]{7}$/.test(clean)) {
      return { valid: true, cleanValue: clean, formatted: clean, fullFormatted: `Passport: ${clean}` };
    }
    // General international passport format (6 to 9 alphanumeric characters)
    if (/^[A-Z0-9]{6,9}$/.test(clean)) {
      return { valid: true, cleanValue: clean, formatted: clean, fullFormatted: `Passport: ${clean}` };
    }
    return { valid: false, error: 'Enter a valid passport number using 1 uppercase letter followed by 7 digits.' };
  }

  // 4. Driving Licence: Indian DL structure (State code 2 letters + RTO/Year/Number, total 15-16 chars)
  if (normType.includes('driv') || normType === 'dl') {
    const clean = idVal.replace(/[\s-]/g, '').toUpperCase();
    // Validate Indian Driving Licence structure: 2 letters followed by 13-14 alphanumeric/digits
    if (/^[A-Z]{2}[0-9]{2}[0-9A-Z]{11,12}$/.test(clean) || /^[A-Z]{2}[0-9A-Z]{11,14}$/.test(clean)) {
      return { valid: true, cleanValue: clean, formatted: clean, fullFormatted: `Driving Licence: ${clean}` };
    }
    return { valid: false, error: 'Enter a valid Driving Licence number (e.g., TN01 20200012345).' };
  }

  // 5. Voter ID / EPIC: 3 uppercase letters followed by 7 digits (10 characters)
  if (normType.includes('voter') || normType.includes('epic') || normType.includes('election')) {
    const clean = idVal.replace(/[\s-]/g, '').toUpperCase();
    if (clean.length !== 10 || !/^[A-Z]{3}[0-9]{7}$/.test(clean)) {
      return { valid: false, error: 'Enter a valid Voter ID number (e.g., ABC1234567).' };
    }
    return { valid: true, cleanValue: clean, formatted: clean, fullFormatted: `Voter ID: ${clean}` };
  }

  // 6. Others / Custom ID: Between 4 and 30 characters, alphanumeric and safe symbols
  const cleanOther = idVal.trim();
  if (cleanOther.length < 4 || cleanOther.length > 30) {
    return { valid: false, error: 'ID number must be between 4 and 30 characters.' };
  }
  if (!/^[A-Za-z0-9\/\s\-_]+$/.test(cleanOther)) {
    return { valid: false, error: 'ID number contains invalid special characters.' };
  }
  const typeLabel = customSpecifyType.trim() || docType.trim();
  return { valid: true, cleanValue: cleanOther, formatted: cleanOther, fullFormatted: `${typeLabel}: ${cleanOther}` };
}
