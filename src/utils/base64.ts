const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

export function encodeBase64(input: string): string {
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(input);
  }

  let output = '';
  let i = 0;
  while (i < input.length) {
    const a = input.charCodeAt(i++);
    const b = i < input.length ? input.charCodeAt(i++) : NaN;
    const c = i < input.length ? input.charCodeAt(i++) : NaN;
    const n = (a << 16) | ((isNaN(b) ? 0 : b) << 8) | (isNaN(c) ? 0 : c);
    output +=
      BASE64_CHARS[n >> 18 & 63] +
      BASE64_CHARS[n >> 12 & 63] +
      BASE64_CHARS[isNaN(b) ? 64 : (n >> 6) & 63] +
      BASE64_CHARS[isNaN(c) ? 64 : n & 63];
  }
  return output;
}

export function decodeBase64(input: string): string {
  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(input);
  }

  let output = '';
  input = input.replace(/[^A-Za-z0-9+/=]/g, '');
  let i = 0;
  while (i < input.length) {
    const enc1 = BASE64_CHARS.indexOf(input.charAt(i++));
    const enc2 = BASE64_CHARS.indexOf(input.charAt(i++));
    const enc3 = BASE64_CHARS.indexOf(input.charAt(i++));
    const enc4 = BASE64_CHARS.indexOf(input.charAt(i++));
    const n = (enc1 << 18) | (enc2 << 12) | ((enc3 & 63) << 6) | (enc4 & 63);
    if (enc3 !== 64) output += String.fromCharCode((n >> 16) & 255);
    if (enc4 !== 64) output += String.fromCharCode((n >> 8) & 255);
  }
  return output;
}
