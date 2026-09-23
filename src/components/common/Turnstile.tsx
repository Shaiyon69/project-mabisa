import { useEffect, useRef, useState } from 'react';
import { turnstileSiteKey } from '../../lib/captcha';
import { logDev } from '../../lib/utils';

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: 'auto' | 'light' | 'dark';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptLoad: Promise<TurnstileApi> | null = null;

/** One script tag per page, however many times the sign-in screen mounts. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }

  scriptLoad ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');

    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not start')));
    script.onerror = () => {
      // Offline, most likely. Forget the attempt so the next mount tries again.
      scriptLoad = null;
      script.remove();
      reject(new Error('Turnstile script failed to load'));
    };
    document.head.appendChild(script);
  });

  return scriptLoad;
}

type TurnstileProps = {
  /** A fresh token, or null when there is none to send (expired, failed, or used). */
  onToken: (token: string | null) => void;
  /**
   * Bump after every request that spent the token. Supabase accepts each token
   * once, so a second attempt with the same one fails as a captcha error.
   */
  resetKey: number;
};

/** Cloudflare Turnstile, the captcha Supabase Auth checks. Rendered only when `turnstileSiteKey` is set. */
export function Turnstile({ onToken, resetKey }: TurnstileProps) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Held in a ref so a new callback from the parent does not re-render the widget.
  const tokenHandler = useRef(onToken);

  useEffect(() => {
    tokenHandler.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;

    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) {
          return;
        }

        widgetId.current = api.render(container.current, {
          sitekey: turnstileSiteKey,
          theme: 'auto',
          callback: (token) => tokenHandler.current(token),
          'expired-callback': () => tokenHandler.current(null),
          'error-callback': () => tokenHandler.current(null),
        });
      })
      .catch((error: unknown) => {
        logDev('Captcha unavailable', error instanceof Error ? error.message : String(error));

        if (!cancelled) {
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;

      if (widgetId.current) {
        window.turnstile?.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (resetKey === 0 || !widgetId.current) {
      return;
    }

    tokenHandler.current(null);
    window.turnstile?.reset(widgetId.current);
  }, [resetKey]);

  return (
    <div className="captcha">
      <div ref={container} />
      {failed ? (
        <p className="muted">The security check could not load. Signing in needs a connection — check it, then reopen the app.</p>
      ) : null}
    </div>
  );
}
