const DEFAULT_PET_FALLBACK = 'https://placehold.co/600x420/e2e8f0/475569?text=Pet+Photo';

function getApiOrigin() {
  const apiBaseUrl = import.meta.env.VITE_API_URL || '/api';

  if (/^https?:\/\//i.test(apiBaseUrl)) {
    return new URL(apiBaseUrl).origin;
  }

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return '';
}

export function resolvePetImageUrl(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (/^(data:|blob:)/i.test(trimmed)) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const apiOrigin = getApiOrigin();
  if (!apiOrigin) {
    return trimmed;
  }

  const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return new URL(normalizedPath, apiOrigin).toString();
}

export function getPetImageSrc(photoUrl, fallback = DEFAULT_PET_FALLBACK) {
  return resolvePetImageUrl(photoUrl) || fallback;
}

export { DEFAULT_PET_FALLBACK };
