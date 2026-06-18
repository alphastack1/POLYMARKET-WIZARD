import { envCheck, json } from "./_env";
import { optionalAuth } from "./_auth";

export default async function handler(req: Request) {
  const auth = optionalAuth(req);
  const env = envCheck();
  return json({
    ...env,
    botAddress: auth ? env.botAddress : undefined,
    authRequired: true,
    authenticated: Boolean(auth),
    sessionAddress: auth?.address,
  });
}
