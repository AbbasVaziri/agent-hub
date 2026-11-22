import { redirect } from "next/navigation";
import { currentUser } from "@/lib/api/handler";

export default async function Home() {
  redirect((await currentUser()) ? "/chat" : "/sign-in");
}
