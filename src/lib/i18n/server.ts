import { cookies } from "next/headers";
import { MESSAGES, type Locale } from "./messages";

export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get("locale")?.value;
  return c === "en" ? "en" : "fa";
}

export async function getMessages() {
  const locale = await getLocale();
  return { locale, t: MESSAGES[locale] };
}
