import { envCheck, json } from "./_env";

export default async function handler() {
  return json(envCheck());
}
