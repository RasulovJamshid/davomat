import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  Command,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import {
  login,
  requestPasswordReset,
  resetPassword,
  type SessionUser,
} from "./api";
import { LanguageSwitcher, useI18n } from "./i18n";

export function LoginPage({
  onAuthenticated,
}: {
  onAuthenticated: (user: SessionUser) => void;
}) {
  const { t } = useI18n();
  const resetToken =
    new URLSearchParams(window.location.search).get("reset") ?? "";
  const [mode, setMode] = useState<"login" | "forgot" | "reset">(
    resetToken ? "reset" : "login",
  );
  const [email, setEmail] = useState("admin@atlas.local");
  const [password, setPassword] = useState(resetToken ? "" : "ChangeMe123!");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [remembered, setRemembered] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    try {
      if (mode === "forgot") {
        await requestPasswordReset(email);
        setNotice(t("resetRequested"));
      } else if (mode === "reset") {
        if (!resetToken) throw new Error(t("invalidResetLink"));
        if (password.length < 10)
          throw new Error(t("atLeastCharacters", { count: 10 }));
        if (password !== confirmation) throw new Error(t("passwordsMismatch"));
        await resetPassword(resetToken, password);
        window.history.replaceState({}, "", window.location.pathname);
        setPassword("");
        setConfirmation("");
        setMode("login");
        setNotice(t("passwordResetSuccess"));
      } else {
        const result = await login(email, password, remembered);
        onAuthenticated(result.user);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("atlasApiUnavailable"),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-story">
        <div className="login-brand">
          <span>
            <Command size={21} />
          </span>
          Atlas
        </div>
        <div className="story-copy">
          <p className="eyebrow">{t("storyEyebrow")}</p>
          <h1>{t("storyTitle")}</h1>
          <p>{t("storyBody")}</p>
          <div className="story-points">
            <span>
              <Clock3 size={18} />
              {t("timeCalculations")}
            </span>
            <span>
              <MapPin size={18} />
              {t("locationVerification")}
            </span>
            <span>
              <ShieldCheck size={18} />
              {t("payrollDecisions")}
            </span>
          </div>
        </div>
        <div className="login-proof">
          <div className="proof-stack">
            <span>AK</span>
            <span>JS</span>
            <span>MN</span>
            <span>+123</span>
          </div>
          <p>
            <strong>{t("wholeTeam")}</strong>
            <span>{t("teamRoles")}</span>
          </p>
        </div>
      </section>
      <section className="login-form-side">
        <form className="login-form" onSubmit={submit}>
          <div className="mobile-login-brand">
            <span>
              <Command size={20} />
            </span>
            Atlas
          </div>
          <div className="login-language">
            <LanguageSwitcher compact />
          </div>
          <p className="eyebrow">
            {mode === "login" ? t("welcomeBack") : t("resetPassword")}
          </p>
          <h2>
            {mode === "login"
              ? t("signInWorkspace")
              : mode === "forgot"
                ? t("checkYourEmail")
                : t("chooseNewPassword")}
          </h2>
          <p className="login-intro">
            {mode === "login"
              ? t("companyAccount")
              : mode === "forgot"
                ? t("resetIntro")
                : t("newPasswordIntro")}
          </p>
          {mode !== "reset" && (
            <label className="login-field">
              <span>{t("email")}</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.uz"
                required
              />
            </label>
          )}
          {mode !== "forgot" && (
            <label className="login-field">
              <span>{mode === "reset" ? t("newPassword") : t("password")}</span>
              <div>
                <input
                  type={visible ? "text" : "password"}
                  autoComplete={
                    mode === "reset" ? "new-password" : "current-password"
                  }
                  minLength={mode === "reset" ? 10 : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setVisible((value) => !value)}
                  aria-label={visible ? t("hidePassword") : t("showPassword")}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
          )}
          {mode === "reset" && (
            <label className="login-field">
              <span>{t("confirmPassword")}</span>
              <div>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                />
              </div>
            </label>
          )}
          {mode === "login" ? (
            <div className="login-options">
              <label>
                <input
                  type="checkbox"
                  checked={remembered}
                  onChange={(event) => setRemembered(event.target.checked)}
                />
                <span>
                  <Check size={12} />
                </span>
                {t("keepSignedIn")}
              </label>
              <button
                type="button"
                className="password-help"
                onClick={() => {
                  setMode("forgot");
                  setError("");
                  setNotice("");
                }}
              >
                {t("forgotPassword")}
              </button>
            </div>
          ) : (
            <div className="login-options">
              <button
                type="button"
                className="password-help"
                onClick={() => {
                  setMode("login");
                  setError("");
                  setNotice("");
                }}
              >
                {t("backToSignIn")}
              </button>
            </div>
          )}
          {notice && (
            <div className="login-success">
              <Check size={17} />
              {notice}
            </div>
          )}
          {error && (
            <div className="login-error">
              <LockKeyhole size={17} />
              {error}
            </div>
          )}
          <button className="login-submit" disabled={loading}>
            {loading ? (
              <LoaderCircle className="spinner" size={18} />
            ) : (
              <>
                {mode === "login"
                  ? t("signIn")
                  : mode === "forgot"
                    ? t("sendResetLink")
                    : t("resetPassword")}{" "}
                <ArrowRight size={18} />
              </>
            )}
          </button>
          {mode === "login" && (
            <div className="demo-credentials">
              <ShieldCheck size={17} />
              <p>
                <strong>{t("developmentAccounts")}</strong>
                <span>{t("manager")}: admin@atlas.local · ChangeMe123!</span>
                <span>
                  {t("employee")}: employee@atlas.local · ChangeMe123!
                </span>
              </p>
            </div>
          )}
        </form>
        <p className="login-footer">{t("protected")}</p>
      </section>
    </main>
  );
}
