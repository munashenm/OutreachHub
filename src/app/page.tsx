import { redirect } from "next/navigation";
import { getSessionContext } from "@/services/auth-service";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSessionContext();
  redirect(session ? "/dashboard" : "/login");
}
