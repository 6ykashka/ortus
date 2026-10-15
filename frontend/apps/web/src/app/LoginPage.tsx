// /auth/login (ADR-0001): заглушка до экрана входа W1.22.
import { T } from './texts.ts';

export function LoginPage() {
  return (
    <section>
      <h1>{T.loginTitle}</h1>
      <p>{T.loginStub}</p>
    </section>
  );
}
