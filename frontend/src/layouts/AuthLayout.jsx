import { Outlet } from 'react-router-dom';
import { Lock, Share2, History } from 'lucide-react';
import Logo from '../components/common/Logo.jsx';
import ThemeToggle from '../components/layout/ThemeToggle.jsx';

const POINTS = [
  [Lock, 'Private by default', 'Role-based access and per-file permissions keep your content yours.'],
  [Share2, 'Share with control', 'Invite people or send expiring, password-protected links.'],
  [History, 'Never lose a version', 'Every upload is versioned. Restore any earlier copy in one click.'],
];

/** Split-screen layout for login/register/forgot/reset/verify. Pages render the form card in <Outlet/>. */
export default function AuthLayout() {
  return (
    <div className="auth-backdrop grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-[rgb(8_58_55)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="grid-lines absolute inset-0" aria-hidden="true" />
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[rgb(70_200_186)]/20 blur-3xl" aria-hidden="true" />
        <Logo className="relative" textClassName="text-white" />
        <div className="relative max-w-md">
          <h2 className="font-display text-4xl font-semibold leading-[1.1]">Your files, in a vault that works the way your team does.</h2>
          <ul className="mt-10 space-y-6">
            {POINTS.map(([Icon, title, text]) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10"><Icon className="h-5 w-5" /></span>
                <span><span className="block font-semibold">{title}</span><span className="text-sm text-white/70">{text}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/50">© {new Date().getFullYear()} CloudVault</p>
      </aside>
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-5 lg:justify-end">
          <Logo className="lg:hidden" />
          <ThemeToggle />
        </div>
        <main className="flex flex-1 items-center justify-center px-5 pb-12">
          <div className="w-full max-w-[26rem]"><Outlet /></div>
        </main>
      </div>
    </div>
  );
}
