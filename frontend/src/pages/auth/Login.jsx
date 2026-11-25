import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Mail, Lock } from 'lucide-react';
import AuthCard, { Alert } from '../../components/common/AuthCard.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import * as authApi from '../../api/auth.js';
import { getErrorCode, getErrorMessage, getFieldErrors } from '../../utils/errors.js';
import { EMAIL_RE } from '../../utils/passwordPolicy.js';

export default function Login() {
  const { login, notice, clearNotice } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const [form, setForm] = useState({ email: location.state?.email ?? '', password: '' });
  const [errors, setErrors] = useState({});
  const [problem, setProblem] = useState(null); // { code, message }
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const info = location.state?.notice;

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };

  const submit = async (e) => {
    e.preventDefault();
    const email = form.email.trim();
    const next = {};
    if (!EMAIL_RE.test(email)) next.email = 'Enter a valid email address.';
    if (!form.password) next.password = 'Enter your password.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setPending(true); setProblem(null); clearNotice();
    try {
      await login(email, form.password); // GuestRoute redirects once the user is set
    } catch (err) {
      const code = getErrorCode(err);
      if (code === 'VALIDATION_ERROR') setErrors(getFieldErrors(err));
      else setProblem({ code, message: getErrorMessage(err) });
      setPending(false);
    }
  };

  const resend = async () => {
    setResending(true);
    try { await authApi.resendVerification(form.email.trim()); toast.success('If that account needs verification, a new email is on its way.'); }
    catch (err) { toast.error(getErrorMessage(err)); }
    finally { setResending(false); }
  };

  return (
    <AuthCard title="Welcome back" subtitle="Sign in to open your vault."
      footer={<>New to CloudVault? <Link to="/register" className="font-semibold text-brand hover:underline">Create an account</Link></>}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {info && <Alert tone="success">{info}</Alert>}
        {notice && !problem && <Alert tone="warning">{notice}</Alert>}
        {problem?.code === 'EMAIL_NOT_VERIFIED' && (
          <Alert tone="warning" action={<Button size="sm" variant="secondary" onClick={resend} loading={resending}>Resend verification email</Button>}>
            Please verify your email address before signing in. We sent you a link when you registered.
          </Alert>
        )}
        {problem?.code === 'ACCOUNT_SUSPENDED' && <Alert tone="danger">{problem.message || 'This account has been suspended. Contact an administrator.'}</Alert>}
        {problem && !['EMAIL_NOT_VERIFIED', 'ACCOUNT_SUSPENDED'].includes(problem.code) && <Alert tone="danger">{problem.message}</Alert>}

        <Input label="Email" type="email" autoComplete="email" inputMode="email" leftIcon={<Mail />} value={form.email} onChange={set('email')} error={errors.email} placeholder="you@company.com" autoFocus />
        <Input label="Password" type="password" revealable autoComplete="current-password" leftIcon={<Lock />} value={form.password} onChange={set('password')} error={errors.password} />
        <div className="flex justify-end"><Link to="/forgot-password" className="text-sm font-semibold text-brand hover:underline">Forgot password?</Link></div>
        <Button type="submit" size="lg" className="w-full" loading={pending}>Sign in</Button>
      </form>
    </AuthCard>
  );
}
