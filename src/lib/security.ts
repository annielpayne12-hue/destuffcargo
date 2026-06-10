// Security validation utilities

export function validateContainerId(id: string): { valid: boolean; message?: string } {
  const trimmed = id.trim().toUpperCase();
  if (!trimmed) return { valid: false, message: 'Container ID is required' };
  if (trimmed.length < 4) return { valid: false, message: 'Container ID must be at least 4 characters' };
  if (trimmed.length > 20) return { valid: false, message: 'Container ID must be at most 20 characters' };
  // Standard container format: 4 letters + 7 digits (e.g., ABCD1234567), but allow flexibility
  if (!/^[A-Z0-9]+$/.test(trimmed)) return { valid: false, message: 'Container ID must contain only letters and numbers' };
  return { valid: true };
}

export function validateVesselName(name: string): { valid: boolean; message?: string } {
  const trimmed = name.trim();
  if (!trimmed) return { valid: false, message: 'Vessel name is required' };
  if (trimmed.length < 2) return { valid: false, message: 'Vessel name must be at least 2 characters' };
  if (trimmed.length > 100) return { valid: false, message: 'Vessel name must be at most 100 characters' };
  return { valid: true };
}

export function validateCommodity(name: string): { valid: boolean; message?: string } {
  const trimmed = name.trim();
  if (trimmed.length > 200) return { valid: false, message: 'Commodity must be at most 200 characters' };
  return { valid: true };
}

export function validateQuantity(qty: number | null): { valid: boolean; message?: string } {
  if (qty === null || qty === undefined) return { valid: true }; // blank is allowed — enter later
  if (isNaN(qty) || qty < 0) return { valid: false, message: 'Quantity must be a non-negative number' };
  if (qty > 999999) return { valid: false, message: 'Quantity exceeds maximum allowed' };
  return { valid: true };
}

export function validateUsername(username: string): { valid: boolean; message?: string } {
  const trimmed = username.trim();
  if (!trimmed) return { valid: false, message: 'Username is required' };
  if (trimmed.length < 3) return { valid: false, message: 'Username must be at least 3 characters' };
  if (trimmed.length > 30) return { valid: false, message: 'Username must be at most 30 characters' };
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) return { valid: false, message: 'Username must contain only letters, numbers, and underscores' };
  return { valid: true };
}

export function validatePassword(password: string): { valid: boolean; message?: string } {
  if (!password || password.length < 8) return { valid: false, message: 'Password must be at least 8 characters' };
  if (!/[A-Z]/.test(password)) return { valid: false, message: 'Password must contain at least one uppercase letter' };
  if (!/[a-z]/.test(password)) return { valid: false, message: 'Password must contain at least one lowercase letter' };
  if (!/[0-9]/.test(password)) return { valid: false, message: 'Password must contain at least one number' };
  return { valid: true };
}

export function sanitizeInput(input: string): string {
  // Remove potentially dangerous characters but preserve normal text
  return input
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim();
}
