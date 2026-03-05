import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  // Seed password: "TestPass1!" — meets CG-FR05 complexity requirements
  const seedPasswordHash = await bcrypt.hash("TestPass1!", 12);

  const alice = await prisma.user.upsert({
    where: { email: "alice@example.com" },
    update: {},
    create: {
      email: "alice@example.com",
      displayName: "Alice",
      passwordHash: seedPasswordHash,
      tier: "pro"
    }
  });

  const bob = await prisma.user.upsert({
    where: { email: "bob@example.com" },
    update: {},
    create: {
      email: "bob@example.com",
      displayName: "Bob",
      passwordHash: seedPasswordHash,
      tier: "pro"
    }
  });

  const charlie = await prisma.user.upsert({
    where: { email: "charlie@example.com" },
    update: {},
    create: {
      email: "charlie@example.com",
      displayName: "Charlie",
      passwordHash: seedPasswordHash,
      tier: "free"
    }
  });

  const session = await prisma.session.create({
    data: {
      topic: "Should cities implement congestion pricing in downtown areas?",
      creatorUserId: alice.id,
      status: "collecting_positions",
      participants: {
        create: [
          {
            userId: alice.id,
            role: "session_creator",
            canExport: true,
            positionText: "Congestion pricing reduces traffic and funds transit.",
            positionSubmittedAt: new Date()
          },
          {
            userId: bob.id,
            role: "session_participant",
            canExport: false,
            positionText: "Congestion pricing unfairly burdens workers who must drive.",
            positionSubmittedAt: new Date()
          }
        ]
      }
    }
  });

  await prisma.session.create({
    data: {
      topic: "Should universities require AI literacy coursework for all majors?",
      creatorUserId: bob.id,
      status: "draft",
      participants: {
        create: [
          { userId: bob.id, role: "session_creator", canExport: true },
          { userId: charlie.id, role: "session_participant", canExport: false }
        ]
      }
    }
  });

  await prisma.session.create({
    data: {
      topic: "Is remote work better for organizational culture than hybrid?",
      creatorUserId: charlie.id,
      status: "draft",
      participants: {
        create: [{ userId: charlie.id, role: "session_creator", canExport: true }]
      }
    }
  });

  console.log(`Seed complete. Created baseline session ${session.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
