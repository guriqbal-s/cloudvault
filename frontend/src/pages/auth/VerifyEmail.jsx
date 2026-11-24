import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeCheck, MailWarning, Mail } from 'lucide-react';
import AuthCard, { Alert } from '../../components/common/AuthCard.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import * as authApi from '../../api/auth.js';
import { getErrorCode, getErrorMessage } from '../../utils/errors.js';
import { EMAIL_RE } from '../../utils/passwordPolicy.js';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const toast = useToast();
  const [state, setState] = useState(token ? { status: 'working' } : { status: 'invalid' }); // working | ok | invalid | error
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState(null);
  const [resending, setResending] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return; // the token is single-use: never fire twice (StrictMode)
    started.current = true;
    authApi.verifyEmail(token)
      .then((data) => setState({ status: 'ok', already: Boolean(data?.alreadyVerified) }))
      .catch((err) => {
        const code = getErrorCode(err);
        setState(code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED' ? { status: 'invalid' } : { status: 'error', message: getErrorMessage(err) });
      });
  }, [token]);

  const resend = async (e) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) { setEmailError('Enter a valid email address.'); return; }
    setResending(true);
    try { await authApi.resendVerification(email.trim()); toast.success('If that account needs verification, a new email is on its way.'); }
    catch (err) { toast.error(getErrorMessage(err)); }
    finally { setResending(false); }
  };

  if (state.status === 'working') {
    return <AuthCard title="Verifying your email…"><div className="flex justify-center py-6"><Spinner className="h-8 w-8" /></div></AuthCard>;
  }
  if (state.status === 'ok') {
    return (
      <AuthCard icon={<BadgeCheck />} title={state.already ? 'Already verified' : 'Email verified'} subtitle="Your account is active. You can sign in now.">
        <Button as={Link} to="/login" size="lg" className="w-full">Continue to sign in</Button>
      </AuthCard>
    );
  }
  if (state.status === 'error') {
    return (
      <AuthCard icon={<MailWarning />} title="Something went wrong" subtitle="We could not verify your email right now.">
        <Alert>{state.message}</Alert>
        <Button className="mt-4 w-full" variant="secondary" onClick={() => window.location.reload()}>Try again</Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard icon={<MailWarning />} title="This link is invalid or expired" subtitle="Enter your email and we will send a fresh verification link."
      footer={<Link to="/login" className="font-semibold text-brand hover:underline">Back to sign in</Link>}>
      <form onSubmit={resend} noValidate className="space-y-4">
        <Input label="Email" type="email" autoComplete="email" leftIcon={<Mail />} value={email} onChange={(e) => { setEmail(e.target.value); setEmailError(null); }} error={emailError} />
        <Button type="submit" size="lg" className="w-full" loading={resending}>Send new link</Button>
      </form>
    </AuthCard>
  );
}
