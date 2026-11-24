import { redirect } from "next/navigation";
import { getAuthContext } from "@/server/context";

export default async function Home() {
  const ctx = await getAuthContext();
  redirect(ctx ? "/dashboard" : "/login");
}
