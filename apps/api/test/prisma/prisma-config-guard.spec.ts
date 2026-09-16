import { assertLocalDatabase } from "../../prisma.config";

// A realistic Supabase pooler URL, shaped like the one that was in .env when
// feature branches migrated the shared database by accident.
const REMOTE =
  "postgresql://postgres.abcdefgh:pw@aws-1-ap-south-1.pooler.supabase.com:5432/postgres";
const LOCAL = "postgresql://postgres:postgres@localhost:5432/codeweaves";

/** argv as the Prisma CLI sees it, plus the command under test. */
const argv = (...command: string[]) => [
  "node",
  "/x/node_modules/.bin/prisma",
  ...command,
];

describe("prisma.config assertLocalDatabase", () => {
  describe("blocks schema-changing commands against a remote database", () => {
    it.each([
      ["migrate dev", ["migrate", "dev"]],
      ["migrate reset", ["migrate", "reset"]],
      ["db push", ["db", "push"]],
    ])("refuses %s", (_label, command) => {
      expect(() => assertLocalDatabase(REMOTE, argv(...command))).toThrow(
        /Refusing to run/,
      );
    });

    it("names the host so the message is actionable", () => {
      // A plain string, not a regex: toThrow() substring-matches either way,
      // and an unanchored regex tested against a URL trips CodeQL's
      // js/regex/missing-regexp-anchor rule.
      expect(() => assertLocalDatabase(REMOTE, argv("migrate", "dev"))).toThrow(
        "aws-1-ap-south-1.pooler.supabase.com",
      );
    });

    it("points at the ADR and the supported path", () => {
      expect(() => assertLocalDatabase(REMOTE, argv("migrate", "dev"))).toThrow(
        /migrate deploy/,
      );
    });

    it("still blocks when extra flags follow the command", () => {
      expect(() =>
        assertLocalDatabase(
          REMOTE,
          argv("migrate", "dev", "--name", "add_thing"),
        ),
      ).toThrow(/Refusing to run/);
    });
  });

  describe("allows the reviewed pipeline and read-only commands", () => {
    // This is what CI runs against staging and production. Blocking it would
    // break the only supported way to change a remote schema.
    it.each([
      ["migrate deploy", ["migrate", "deploy"]],
      ["migrate status", ["migrate", "status"]],
      ["migrate diff", ["migrate", "diff"]],
      ["generate", ["generate"]],
      ["db seed", ["db", "seed"]],
      ["studio", ["studio"]],
    ])("permits %s against a remote database", (_label, command) => {
      expect(() => assertLocalDatabase(REMOTE, argv(...command))).not.toThrow();
    });
  });

  describe("allows schema-changing commands against a local database", () => {
    it.each([
      ["localhost", "postgresql://postgres:postgres@localhost:5432/codeweaves"],
      ["127.0.0.1", "postgresql://postgres:postgres@127.0.0.1:5432/codeweaves"],
      [
        "the compose service name",
        "postgresql://postgres:postgres@postgres:5432/codeweaves",
      ],
      [
        "host.docker.internal",
        "postgresql://postgres:postgres@host.docker.internal:5432/codeweaves",
      ],
    ])("permits migrate dev against %s", (_label, url) => {
      expect(() =>
        assertLocalDatabase(url, argv("migrate", "dev")),
      ).not.toThrow();
    });

    it("permits an IPv6 loopback URL", () => {
      expect(() =>
        assertLocalDatabase(
          "postgresql://postgres:postgres@[::1]:5432/codeweaves",
          argv("migrate", "dev"),
        ),
      ).not.toThrow();
    });
  });

  describe("edge cases", () => {
    it("explains what to do when no URL is set at all", () => {
      expect(() =>
        assertLocalDatabase(undefined, argv("migrate", "dev")),
      ).toThrow(/DIRECT_URL or DATABASE_URL/);
    });

    it("ignores a missing URL for commands it does not guard", () => {
      expect(() =>
        assertLocalDatabase(undefined, argv("generate")),
      ).not.toThrow();
    });

    // Fail closed: an unparseable URL is not proof of being local.
    it("refuses a schema change when the URL cannot be parsed", () => {
      expect(() =>
        assertLocalDatabase("not a url", argv("migrate", "dev")),
      ).toThrow(/Refusing to run/);
    });

    it("does not match a command that merely contains the words out of order", () => {
      expect(() =>
        assertLocalDatabase(REMOTE, argv("dev", "migrate")),
      ).not.toThrow();
    });

    it("does nothing for a local database regardless of command", () => {
      expect(() =>
        assertLocalDatabase(LOCAL, argv("migrate", "reset")),
      ).not.toThrow();
    });
  });
});
