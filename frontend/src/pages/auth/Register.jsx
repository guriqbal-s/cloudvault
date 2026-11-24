import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Lock, User, MailCheck, Check, Circle } from 'lucide-react';
import AuthCard, { Alert } from '../../components/common/AuthCard.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import * as authApi from '../../api/auth.js';
import { getErrorCode, getErrorMessage, getFieldErrors } from '../../utils/errors.js';
import { EMAIL_RE, checkPassword, passwordProblem } from '../../utils/passwordPolicy.js';
import { cn } from '../../utils/cn.js';

function Rule({ ok, children }) {
  const Icon = ok ? Check : Circle;
  return <li className={cn('flex items-center gap-1.5', ok ? 'text-success' : 'text-content-muted')}><Icon className="h-3.5 w-3.5" />{children}</li>;
}

export default function Register() {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(null); // submitted email
  const [resending, setResending] = useState(false);
  const rules = checkPassword(form.password);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };

  const submit = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    const email = form.email.trim();
    const next = {};
    if (name.length < 2) next.name = 'Enter your name.';
    if (!EMAIL_RE.test(email)) next.email = 'Enter a valid email address.';
    const pw = passwordProblem(form.password);
    if (pw) next.password = pw;
    if (form.confirm !== form.password) next.confirm = 'Passwords do not match.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setPending(true); setFormError(null);
    try {
      await authApi.register({ name, email, password: form.password });
      setDone(email);
    } catch (err) {
      const code = getErrorCode(err);
      if (code === 'EMAIL_TAKEN') setErrors({ email: 'An account with this email already exists.' });
      else if (code === 'VALIDATION_ERROR') {
        const fe = getFieldErrors(err);
        setErrors(fe);
        if (fe._form) setFormError(fe._form);
      } else setFormError(getErrorMessage(err));
    } finally { setPending(false); }
  };

  const resend = async () => {
    setResending(true);
    try { await authApi.resendVerification(done); toast.success('Verification email sent again.'); }
    catch (err) { toast.error(getErrorMessage(err)); }
    finally { setResending(false); }
  };

  if (done) {
    return (
      <AuthCard icon={<MailCheck />} title="Check your inbox" subtitle={`We sent a verification link to ${done}. Open it to activate your account.`}
        footer={<Link to="/login" className="font-semibold text-brand hover:underline">Back to sign in</Link>}>
        <div className="space-y-3">
          <Alert tone="info">The link expires after a while. Not there? Check your spam folder.</Alert>
          <Button variant="secondary" className="w-full" onClick={resend} loading={resending}>Resend email</Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your account" subtitle="Start with free storage. No credit card."
      footer={<>Already have an account? <Link to="/login" className="font-semibold text-brand hover:underline">Sign in</Link></>}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <Input label="Full name" autoComplete="name" leftIcon={<User />} value={form.name} onChange={set('name')} error={errors.name} autoFocus />
        <Input label="Email" type="email" autoComplete="email" inputMode="email" leftIcon={<Mail />} value={form.email} onChange={set('email')} error={errors.email} placeholder="you@company.com" />
        <div>
          <Input label="Password" type="password" revealable autoComplete="new-password" leftIcon={<Lock />} value={form.password} onChange={set('password')} error={errors.password} />
          <ul className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-3">
            <Rule ok={rules.length}>10+ characters</Rule><Rule ok={rules.letter}>A letter</Rule><Rule ok={rules.digit}>A number</Rule>
          </ul>
        </div>
        <Input label="Confirm password" type="password" revealable autoComplete="new-password" leftIcon={<Lock />} value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
        <Button type="submit" size="lg" className="w-full" loading={pending}>Create account</Button>
      </form>
    </AuthCard>
  );
}
