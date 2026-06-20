import { envCheck, json } from "./_env";

export default async function handler() {
  const env = envCheck();
  return json({
    ...env,
    authRequired: false,
    authenticated: true,
  });
}
