// Applies the saved theme before first paint so there is no light/dark flash. Loaded as a
// classic blocking script from index.html (a separate file so the CSP can forbid inline scripts).
try {
  var p = localStorage.getItem('cv-theme') || 'system';
  var d = p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', d);
  document.documentElement.style.colorScheme = d ? 'dark' : 'light';
} catch (e) {}
