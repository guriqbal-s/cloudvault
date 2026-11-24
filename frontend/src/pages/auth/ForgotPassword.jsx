import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, KeyRound, MailCheck } from 'lucide-react';
import AuthCard, { Alert } from '../../components/common/AuthCard.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import * as authApi from '../../api/auth.js';
import { getErrorMessage, getFieldErrors } from '../../utils/errors.js';
import { EMAIL_RE } from '../../utils/passwordPolicy.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) { setError('Enter a valid email address.'); return; }
    setPending(true); setError(null); setFormError(null);
    try { await authApi.forgotPassword(value); setSent(true); }
    catch (err) {
      const fe = getFieldErrors(err);
      if (fe.email) setError(fe.email); else setFormError(getErrorMessage(err));
    } finally { setPending(false); }
  };

  const back = <Link to="/login" className="font-semibold text-brand hover:underline">Back to sign in</Link>;
  if (sent) {
    return (
      <AuthCard icon={<MailCheck />} title="Check your inbox" subtitle={`If an account exists for ${email.trim()}, a reset link is on its way. It expires soon, so use it promptly.`} footer={back}>
        <Button variant="secondary" className="w-full" onClick={() => setSent(false)}>Use a different email</Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard icon={<KeyRound />} title="Forgot your password?" subtitle="Enter your email and we will send you a link to choose a new one." footer={back}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <Input label="Email" type="email" autoComplete="email" inputMode="email" leftIcon={<Mail />} value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} error={error} autoFocus />
        <Button type="submit" size="lg" className="w-full" loading={pending}>Send reset link</Button>
      </form>
    </AuthCard>
  );
}
