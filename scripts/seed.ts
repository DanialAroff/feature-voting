// Resets the database to a known demo state. Development only.
//   npm run db:seed
import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hashPassword } from "../src/server/auth/password";
import * as schema from "../src/server/db/schema";
import type { RequestStatus } from "../src/server/db/schema";

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed a production database");
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: "snake_case" });

// Demo-only credentials, documented in the README.
const DEMO_PASSWORD = "password123";
const people = [
  { key: "admin", email: "admin@example.com", displayName: "Ada Admin", role: "admin" },
  { key: "alice", email: "alice@example.com", displayName: "Alice", role: "user" },
  { key: "bob", email: "bob@example.com", displayName: "Bob", role: "user" },
  { key: "carol", email: "carol@example.com", displayName: "Carol", role: "user" },
  { key: "dan", email: "dan@example.com", displayName: "Dan", role: "user" },
] as const;
type Person = (typeof people)[number]["key"];

type SeedRequest = {
  title: string;
  description: string;
  author: Person;
  status: RequestStatus;
  voters: Person[]; // author's auto-vote is added automatically (D4)
  comments: { by: Person; body: string; kind?: "user" | "official" }[];
};

const seedRequests: SeedRequest[] = [
  {
    title: "Dark mode",
    description: "A dark theme for the whole app, ideally following the OS setting.",
    author: "alice",
    status: "in_progress",
    voters: ["bob", "carol", "dan"],
    comments: [
      { by: "bob", body: "Yes please, my eyes at night." },
      { by: "admin", kind: "official", body: "We're building this now; expect it next release." },
    ],
  },
  {
    title: "Export requests to CSV",
    description: "Let admins download all requests with vote counts for planning meetings.",
    author: "bob",
    status: "planned",
    voters: ["admin", "carol"],
    comments: [{ by: "carol", body: "Would be great to include comment counts too." }],
  },
  {
    title: "Email notifications on status change",
    description: "Notify voters when a request they voted for changes status.",
    author: "carol",
    status: "under_review",
    voters: ["alice", "bob", "dan"],
    comments: [],
  },
  {
    title: "Notify me when my request changes status",
    description: "I'd like an email when something I submitted moves forward.",
    author: "dan",
    status: "under_review",
    voters: ["alice"],
    comments: [{ by: "alice", body: "Isn't this the same as the email notifications one?" }],
  },
  {
    title: "Markdown in comments",
    description: "Support basic formatting (bold, lists, links) in comments.",
    author: "alice",
    status: "released",
    voters: ["dan"],
    comments: [{ by: "admin", kind: "official", body: "Shipped in v1.4. Thanks for the idea!" }],
  },
  {
    title: "Blockchain-based voting",
    description: "Store all votes on a blockchain for transparency.",
    author: "bob",
    status: "declined",
    voters: [],
    comments: [
      {
        by: "admin",
        kind: "official",
        body: "Thanks, but this adds a lot of complexity for little user benefit, so we won't pursue it.",
      },
    ],
  },
  {
    title: "Keyboard shortcuts",
    description: "Shortcuts for voting, searching and navigating between requests.",
    author: "carol",
    status: "under_review",
    voters: [],
    comments: [],
  },
];

// Statuses reached through this path, so status history looks realistic.
const statusPath: Record<RequestStatus, RequestStatus[]> = {
  under_review: [],
  planned: ["planned"],
  in_progress: ["planned", "in_progress"],
  released: ["planned", "in_progress", "released"],
  declined: ["declined"],
};

async function main() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      TRUNCATE request_merges, status_changes, comments, votes, requests, sessions, users
      RESTART IDENTITY CASCADE
    `);

    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const insertedUsers = await tx
      .insert(schema.users)
      .values(people.map(({ email, displayName, role }) => ({ email, displayName, role, passwordHash })))
      .returning({ id: schema.users.id, email: schema.users.email });
    const userId = Object.fromEntries(
      people.map((p) => [p.key, insertedUsers.find((u) => u.email === p.email)!.id]),
    ) as Record<Person, number>;

    for (const r of seedRequests) {
      const [request] = await tx
        .insert(schema.requests)
        .values({
          title: r.title,
          description: r.description,
          authorId: userId[r.author],
          status: r.status,
        })
        .returning({ id: schema.requests.id });

      const voters = new Set<Person>([r.author, ...r.voters]);
      await tx
        .insert(schema.votes)
        .values([...voters].map((v) => ({ requestId: request.id, userId: userId[v] })));

      if (r.comments.length) {
        await tx.insert(schema.comments).values(
          r.comments.map((c) => ({
            requestId: request.id,
            authorId: userId[c.by],
            kind: c.kind ?? "user",
            body: c.body,
          })),
        );
      }

      let from: RequestStatus = "under_review";
      for (const to of statusPath[r.status]) {
        await tx
          .insert(schema.statusChanges)
          .values({ requestId: request.id, actorId: userId.admin, fromStatus: from, toStatus: to });
        from = to;
      }
    }

    // Derive counters from the rows so the seed can never disagree with them.
    await tx.execute(sql`
      UPDATE requests r SET
        vote_count = (SELECT count(*) FROM votes v WHERE v.request_id = r.id),
        comment_count = (SELECT count(*) FROM comments c WHERE c.request_id = r.id)
    `);
  });

  console.log(`Seeded ${people.length} users and ${seedRequests.length} requests.`);
  console.log(`Log in as admin@example.com (or alice/bob/carol/dan@example.com) / ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
