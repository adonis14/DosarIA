import { redirect } from "next/navigation";
import { getAuthContext, getMfaPendingSession } from "@/server/context";

export default async function Home() {
  const ctx = await getAuthContext();
  if (ctx) redirect("/dashboard");
  redirect((await getMfaPendingSession()) ? "/auth/mfa" : "/login");
}
