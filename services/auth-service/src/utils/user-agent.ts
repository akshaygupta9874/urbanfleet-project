export interface ParsedClientInfo {
  deviceType: 'Desktop' | 'Mobile' | 'Tablet' | 'Unknown';
  browser: string;
  os: string;
  ipAddress?: string;
}

/**
 * Lightweight, zero-dependency User-Agent parser that cleanly extracts
 * human-readable device category, browser name & version, and OS.
 */
export function parseClientInfo(userAgent?: string, ipAddress?: string): ParsedClientInfo {
  if (!userAgent || typeof userAgent !== 'string') {
    return {
      deviceType: 'Unknown',
      browser: 'Unknown Browser',
      os: 'Unknown OS',
      ipAddress: ipAddress || 'Unknown IP',
    };
  }

  const ua = userAgent.toLowerCase();

  // 1. Determine Device Type
  let deviceType: 'Desktop' | 'Mobile' | 'Tablet' | 'Unknown' = 'Desktop';
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) {
    deviceType = 'Tablet';
  } else if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) {
    deviceType = 'Mobile';
  } else if (/windows|macintosh|linux|cros/i.test(ua)) {
    deviceType = 'Desktop';
  }

  // 2. Determine OS
  let os = 'Unknown OS';
  if (ua.includes('windows nt 10.0')) os = 'Windows 10/11';
  else if (ua.includes('windows nt 6.3')) os = 'Windows 8.1';
  else if (ua.includes('windows nt 6.1')) os = 'Windows 7';
  else if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('iphone os') || ua.includes('ios')) {
    const match = ua.match(/os (\d+[._]\d+)/);
    os = match ? `iOS ${match[1].replace('_', '.')}` : 'iOS';
  } else if (ua.includes('mac os x') || ua.includes('macintosh')) {
    const match = ua.match(/mac os x (\d+[._]\d+)/);
    os = match ? `macOS ${match[1].replace('_', '.')}` : 'macOS';
  } else if (ua.includes('android')) {
    const match = ua.match(/android (\d+(\.\d+)?)/);
    os = match ? `Android ${match[1]}` : 'Android';
  } else if (ua.includes('cros')) {
    os = 'ChromeOS';
  } else if (ua.includes('linux')) {
    os = 'Linux';
  }

  // 3. Determine Browser
  let browser = 'Unknown Browser';
  if (ua.includes('edg/')) {
    const match = ua.match(/edg\/(\d+)/);
    browser = match ? `Edge ${match[1]}` : 'Edge';
  } else if (ua.includes('opr/') || ua.includes('opera')) {
    const match = ua.match(/opr\/(\d+)/);
    browser = match ? `Opera ${match[1]}` : 'Opera';
  } else if (ua.includes('chrome/') && !ua.includes('chromium')) {
    const match = ua.match(/chrome\/(\d+)/);
    browser = match ? `Chrome ${match[1]}` : 'Chrome';
  } else if (ua.includes('firefox/')) {
    const match = ua.match(/firefox\/(\d+)/);
    browser = match ? `Firefox ${match[1]}` : 'Firefox';
  } else if (ua.includes('safari/') && !ua.includes('chrome')) {
    const match = ua.match(/version\/(\d+)/);
    browser = match ? `Safari ${match[1]}` : 'Safari';
  }

  return {
    deviceType,
    browser,
    os,
    ipAddress: ipAddress || 'Unknown IP',
  };
}
