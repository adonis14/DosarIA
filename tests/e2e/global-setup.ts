import { writeFileSync } from "node:fs";
import { buildWorld } from "../helpers/world";

export const WORLD_FILE = "tests/e2e/.world.json";

export default async function globalSetup() {
  const w = await buildWorld();
  // Only ids, emails and the synthetic local test password — no API keys.
  const serializable = {
    tag: w.tag,
    orgA: w.orgA,
    orgB: w.orgB,
    caseA1: w.caseA1,
    caseA2: w.caseA2,
    caseB1: w.caseB1,
    users: {
      adminA: w.adminA.email,
      lawyerA1: w.lawyerA1.email,
      lawyerA2: w.lawyerA2.email,
      assistantA: w.assistantA.email,
      adminB: w.adminB.email,
      lawyerB1: w.lawyerB1.email,
    },
  };
  writeFileSync(WORLD_FILE, JSON.stringify(serializable, null, 2));
}
