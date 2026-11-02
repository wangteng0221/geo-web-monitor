import { domainToASCII } from 'node:url';

// A single URL policy is shared by reports and the source library. Preserve
// the original URL for evidence; normalize only the host used for grouping.
export function webUrlInfo(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || !/^https?:\/\//i.test(value) || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname) return null;
    const ascii = domainToASCII(hostname) || hostname;
    return { url: value, host: ascii.replace(/^www\./, '') };
  } catch {
    return null;
  }
}

export function webHost(value) {
  return webUrlInfo(value)?.host ?? null;
}

export const citationHost = webHost;
