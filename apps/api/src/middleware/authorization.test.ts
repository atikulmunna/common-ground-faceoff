import { describe, it, expect } from "vitest";
import { checkPermission } from "../middleware/authorization.js";
import type { AuthzAction } from "../middleware/authorization.js";

/* ------------------------------------------------------------------ */
/*  CG-FR61 / CG-FR62: Authorization matrix unit tests                */
/* ------------------------------------------------------------------ */

const creator = { creatorUserId: "user-1", participants: [{ userId: "user-1", canExport: true }] };
const withParticipant = {
  creatorUserId: "user-1",
  participants: [
    { userId: "user-1", canExport: true },
    { userId: "user-2", canExport: false },
    { userId: "user-3", canExport: true },
  ],
};

describe("Authorization matrix (CG-FR61)", () => {
  /* ---- create_session ---- */
  describe("create_session", () => {
    it("allows individual_user", () => {
      const r = checkPermission("create_session", "individual_user", "u1");
      expect(r.allowed).toBe(true);
    });
    it("allows session_creator", () => {
      const r = checkPermission("create_session", "session_creator", "u1");
      expect(r.allowed).toBe(true);
    });
    it("denies session_participant", () => {
      const r = checkPermission("create_session", "session_participant", "u1");
      expect(r.allowed).toBe(false);
    });
    it("allows institutional_admin", () => {
      const r = checkPermission("create_session", "institutional_admin", "u1");
      expect(r.allowed).toBe(true);
    });
    it("denies moderator", () => {
      const r = checkPermission("create_session", "moderator", "u1");
      expect(r.allowed).toBe(false);
    });
  });

  /* ---- invite_participants ---- */
  describe("invite_participants", () => {
    it("allows creator of the session", () => {
      const r = checkPermission("invite_participants", "individual_user", "user-1", creator);
      expect(r.allowed).toBe(true);
      expect(r.effectiveRole).toBe("session_creator");
    });
    it("denies participant who is not creator", () => {
      const r = checkPermission("invite_participants", "individual_user", "user-2", withParticipant);
      expect(r.allowed).toBe(false);
    });
    it("allows institutional_admin", () => {
      const r = checkPermission("invite_participants", "institutional_admin", "admin-1", withParticipant);
      expect(r.allowed).toBe(true);
    });
  });

  /* ---- trigger_analysis ---- */
  describe("trigger_analysis", () => {
    it("allows session creator", () => {
      const r = checkPermission("trigger_analysis", "individual_user", "user-1", creator);
      expect(r.allowed).toBe(true);
      expect(r.effectiveRole).toBe("session_creator");
    });
    it("denies regular participant", () => {
      const r = checkPermission("trigger_analysis", "individual_user", "user-2", withParticipant);
      expect(r.allowed).toBe(false);
    });
    it("allows institutional_admin", () => {
      const r = checkPermission("trigger_analysis", "institutional_admin", "admin", withParticipant);
      expect(r.allowed).toBe(true);
    });
    it("denies moderator", () => {
      const r = checkPermission("trigger_analysis", "moderator", "mod", withParticipant);
      expect(r.allowed).toBe(false);
    });
  });

  /* ---- export_session ---- */
  describe("export_session", () => {
    it("allows session creator", () => {
      const r = checkPermission("export_session", "individual_user", "user-1", creator);
      expect(r.allowed).toBe(true);
    });
    it("allows participant with canExport=true", () => {
      const r = checkPermission("export_session", "individual_user", "user-3", withParticipant);
      expect(r.allowed).toBe(true);
    });
    it("denies participant with canExport=false", () => {
      const r = checkPermission("export_session", "individual_user", "user-2", withParticipant);
      expect(r.allowed).toBe(false);
    });
    it("allows institutional_admin (org scope)", () => {
      const r = checkPermission("export_session", "institutional_admin", "admin", withParticipant);
      expect(r.allowed).toBe(true);
    });
    it("denies moderator", () => {
      const r = checkPermission("export_session", "moderator", "mod", withParticipant);
      expect(r.allowed).toBe(false);
    });
  });

  /* ---- revoke_share_links ---- */
  describe("revoke_share_links", () => {
    it("allows session creator", () => {
      const r = checkPermission("revoke_share_links", "individual_user", "user-1", creator);
      expect(r.allowed).toBe(true);
    });
    it("denies participant", () => {
      const r = checkPermission("revoke_share_links", "individual_user", "user-2", withParticipant);
      expect(r.allowed).toBe(false);
    });
    it("allows institutional_admin", () => {
      const r = checkPermission("revoke_share_links", "institutional_admin", "admin", creator);
      expect(r.allowed).toBe(true);
    });
  });

  /* ---- moderate_flagged_content ---- */
  describe("moderate_flagged_content", () => {
    it("allows moderator", () => {
      const r = checkPermission("moderate_flagged_content", "moderator", "mod");
      expect(r.allowed).toBe(true);
    });
    it("denies individual_user", () => {
      const r = checkPermission("moderate_flagged_content", "individual_user", "u1");
      expect(r.allowed).toBe(false);
    });
    it("denies institutional_admin", () => {
      const r = checkPermission("moderate_flagged_content", "institutional_admin", "admin");
      expect(r.allowed).toBe(false);
    });
  });

  /* ---- access_org_analytics ---- */
  describe("access_org_analytics", () => {
    it("allows institutional_admin", () => {
      const r = checkPermission("access_org_analytics", "institutional_admin", "admin");
      expect(r.allowed).toBe(true);
    });
    it("denies all other roles", () => {
      for (const role of ["individual_user", "session_creator", "session_participant", "moderator"] as const) {
        const r = checkPermission("access_org_analytics", role, "u1");
        expect(r.allowed).toBe(false);
      }
    });
  });

  /* ---- manage_cohorts ---- */
  describe("manage_cohorts", () => {
    it("allows institutional_admin", () => {
      const r = checkPermission("manage_cohorts", "institutional_admin", "admin");
      expect(r.allowed).toBe(true);
    });
    it("denies all other roles", () => {
      for (const role of ["individual_user", "session_creator", "session_participant", "moderator"] as const) {
        const r = checkPermission("manage_cohorts", role, "u1");
        expect(r.allowed).toBe(false);
      }
    });
  });

  /* ---- effective role resolution ---- */
  describe("effective role resolution", () => {
    it("elevates individual_user to session_creator when they own the session", () => {
      const r = checkPermission("create_session", "individual_user", "user-1", creator);
      expect(r.effectiveRole).toBe("session_creator");
    });
    it("elevates individual_user to session_participant when they are a participant", () => {
      const r = checkPermission("export_session", "individual_user", "user-2", withParticipant);
      expect(r.effectiveRole).toBe("session_participant");
    });
    it("keeps institutional_admin role regardless of session membership", () => {
      const r = checkPermission("trigger_analysis", "institutional_admin", "user-1", creator);
      expect(r.effectiveRole).toBe("institutional_admin");
    });
    it("keeps moderator role regardless of session membership", () => {
      const r = checkPermission("moderate_flagged_content", "moderator", "user-1", creator);
      expect(r.effectiveRole).toBe("moderator");
    });
  });

  /* ---- full matrix sweep ---- */
  describe("full matrix coverage", () => {
    const allActions: AuthzAction[] = [
      "create_session", "invite_participants", "view_own_position",
      "view_others_positions_pre_analysis", "trigger_analysis",
      "export_session", "revoke_share_links", "moderate_flagged_content",
      "access_org_analytics", "manage_cohorts",
    ];
    const allRoles = [
      "individual_user", "session_creator", "session_participant",
      "institutional_admin", "moderator",
    ] as const;

    it("returns a valid result for every action × role combination", () => {
      for (const action of allActions) {
        for (const role of allRoles) {
          const r = checkPermission(action, role, "test-user");
          expect(r).toHaveProperty("allowed");
          expect(r).toHaveProperty("permission");
          expect(r).toHaveProperty("effectiveRole");
          expect(typeof r.allowed).toBe("boolean");
        }
      }
    });
  });
});
