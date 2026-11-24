// Turns a raw User-Agent into a short label for the "active sessions" list,
// e.g. "Chrome on Windows". Deliberately simple: no dependency, order-sensitive checks.

export function describeUserAgent(ua) {
  if (typeof ua !== 'string' || !ua.trim()) return 'Unknown device';

  let browser = 'Unknown browser';
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  else if (/curl\//i.test(ua)) browser = 'curl';

  // iPhone/iPad UAs contain "like Mac OS X" and Android UAs contain "Linux", so test those first.
  let os = 'Unknown OS';
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux|X11/.test(ua)) os = 'Linux';

  if (browser === 'Unknown browser' && os === 'Unknown OS') return 'Unknown device';
  return `${browser} on ${os}`;
}
