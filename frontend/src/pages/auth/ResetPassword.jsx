import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Link2 } from 'lucide-react';
import AuthCard, { Alert } from '../../components/common/AuthCard.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import * as authApi from '../../api/auth.js';
import { getErrorCode, getErrorMessage, getFieldErrors } from '../../utils/errors.js';
import { passwordProblem } from '../../utils/passwordPolicy.js';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [problem, setProblem] = useState(null);
  const [badLink, setBadLink] = useState(false);
  const [pending, setPending] = useState(false);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };

  if (!token || badLink) {
    return (
      <AuthCard icon={<Link2 />} title="This link is no longer valid" subtitle="Reset links work once and expire quickly. Request a new one to continue."
        footer={<Link to="/login" className="font-semibold text-brand hover:underline">Back to sign in</Link>}>
        <Button as={Link} to="/forgot-password" size="lg" className="w-full">Request a new link</Button>
      </AuthCard>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    const pw = passwordProblem(form.password);
    if (pw) next.password = pw;
    if (form.confirm !== form.password) next.confirm = 'Passwords do not match.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setPending(true); setProblem(null);
    try {
      await authApi.resetPassword(token, form.password);
      navigate('/login', { replace: true, state: { notice: 'Password updated. Sign in with your new password.' } });
    } catch (err) {
      const code = getErrorCode(err);
      if (code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED') setBadLink(true);
      else if (code === 'VALIDATION_ERROR') { const fe = getFieldErrors(err); setErrors({ password: fe.password ?? fe.newPassword, ...fe }); }
      else setProblem(getErrorMessage(err));
      setPending(false);
    }
  };

  return (
    <AuthCard title="Choose a new password" subtitle="You will be signed out on all devices.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {problem && <Alert>{problem}</Alert>}
        <Input label="New password" type="password" revealable autoComplete="new-password" leftIcon={<Lock />} value={form.password} onChange={set('password')} error={errors.password} hint="10+ characters with a letter and a number." autoFocus />
        <Input label="Confirm new password" type="password" revealable autoComplete="new-password" leftIcon={<Lock />} value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
        <Button type="submit" size="lg" className="w-full" loading={pending}>Update password</Button>
      </form>
    </AuthCard>
  );
}
