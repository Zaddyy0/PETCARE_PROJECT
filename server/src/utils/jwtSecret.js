let warnedAboutFallback = false;

export function getJwtSecret() {
  const configuredSecret = process.env.JWT_SECRET?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn('JWT_SECRET is not set. Using a development fallback secret so auth can still run.');
  }

  return 'petcare-development-secret';
}