// Plain-text + minimal HTML email bodies for the auth flows. Pure functions (no I/O).

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function layout({ heading, paragraphs, action, footer }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#4f46e5;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(action.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;color:#6b7280;word-break:break-all">Or paste this link into your browser:<br>${escapeHtml(action.url)}</p>`
    : '';
  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827">` +
    `<h2 style="margin:0 0 20px">${escapeHtml(heading)}</h2>${body}${button}` +
    `<p style="margin:24px 0 0;font-size:12px;color:#9ca3af">${escapeHtml(footer)}</p></div>`
  );
}

export function verifyEmailMail({ name, email, url, hours }) {
  const lines = [`Hi ${name},`, 'Welcome to CloudVault! Please confirm your email address to activate your account.'];
  const footer = `This link expires in ${hours} hours. If you did not create a CloudVault account you can ignore this email.`;
  return {
    to: email,
    subject: 'Confirm your CloudVault email address',
    text: `${lines.join('\n\n')}\n\nConfirm your email: ${url}\n\n${footer}`,
    html: layout({ heading: 'Confirm your email', paragraphs: lines, action: { label: 'Confirm email', url }, footer }),
  };
}

export function resetPasswordMail({ name, email, url, minutes }) {
  const lines = [`Hi ${name},`, 'We received a request to reset your CloudVault password.'];
  const footer = `This link expires in ${minutes} minutes and can be used once. If you did not request a reset, ignore this email: your password will not change.`;
  return {
    to: email,
    subject: 'Reset your CloudVault password',
    text: `${lines.join('\n\n')}\n\nChoose a new password: ${url}\n\n${footer}`,
    html: layout({ heading: 'Reset your password', paragraphs: lines, action: { label: 'Choose a new password', url }, footer }),
  };
}

export function passwordChangedMail({ name, email }) {
  const lines = [
    `Hi ${name},`,
    'The password for your CloudVault account was just changed, and you were signed out of your other devices.',
  ];
  const footer = 'If this was not you, reset your password immediately and contact an administrator.';
  return {
    to: email,
    subject: 'Your CloudVault password was changed',
    text: `${lines.join('\n\n')}\n\n${footer}`,
    html: layout({ heading: 'Password changed', paragraphs: lines, footer }),
  };
}
