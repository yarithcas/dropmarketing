import { json } from "@/lib/server/api";
import { demoWorkspace } from "@/lib/server/seed-workspace";

/** Example workspace for demo visitors (stored in their browser afterwards). */
export async function GET() {
  return json(demoWorkspace());
}
