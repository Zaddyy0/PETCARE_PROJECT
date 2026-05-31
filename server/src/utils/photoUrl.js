function getRequestOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

export function normalizePhotoUrlForClient(req, value) {
  if (!value) {
    return '';
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('/uploads/')) {
    return new URL(trimmed, getRequestOrigin(req)).toString();
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsedUrl = new URL(trimmed);
      const requestOrigin = getRequestOrigin(req);

      if (parsedUrl.origin === requestOrigin && parsedUrl.pathname.startsWith('/uploads/')) {
        return parsedUrl.toString();
      }
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}
