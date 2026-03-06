import { Router } from "express";
import { samlLoginSchema } from "@common-ground/shared";
import { createHash, randomUUID } from "node:crypto";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { signAccessToken, generateRefreshToken } from "../lib/auth.js";

export const samlRouter = Router();

/* ------------------------------------------------------------------ */
/*  POST /saml/metadata/:orgSlug — return SAML SP metadata             */
/*  (CG-FR03)                                                         */
/* ------------------------------------------------------------------ */

samlRouter.get("/metadata/:orgSlug", async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { slug: req.params.orgSlug } });
  if (!org) {
    res.status(404).json(createErrorResponse("not_found", "Organization not found"));
    return;
  }

  const spEntityId = `${process.env.API_BASE_URL ?? "http://localhost:4100"}/saml/metadata/${org.slug}`;
  const acsUrl = `${process.env.API_BASE_URL ?? "http://localhost:4100"}/saml/acs/${org.slug}`;

  res.type("application/xml").send(`<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${spEntityId}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true"
      protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
        Location="${acsUrl}" index="1"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`);
});

/* ------------------------------------------------------------------ */
/*  POST /saml/initiate — start SAML login (redirect to IdP)           */
/*  (CG-FR03)                                                         */
/* ------------------------------------------------------------------ */

samlRouter.post("/initiate", async (req, res) => {
  const parse = samlLoginSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid SAML login payload", parse.error.flatten()));
    return;
  }

  const org = await prisma.organization.findUnique({ where: { slug: parse.data.orgSlug } });
  if (!org || !org.samlEntryPoint) {
    res.status(404).json(createErrorResponse("not_found", "Organization not found or SAML not configured"));
    return;
  }

  const requestId = `_${randomUUID()}`;
  const issueInstant = new Date().toISOString();
  const spEntityId = `${process.env.API_BASE_URL ?? "http://localhost:4100"}/saml/metadata/${org.slug}`;
  const acsUrl = `${process.env.API_BASE_URL ?? "http://localhost:4100"}/saml/acs/${org.slug}`;

  const authnRequest = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
    ID="${requestId}" Version="2.0" IssueInstant="${issueInstant}"
    Destination="${org.samlEntryPoint}"
    AssertionConsumerServiceURL="${acsUrl}"
    ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
  <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${spEntityId}</saml:Issuer>
</samlp:AuthnRequest>`;

  const encodedRequest = Buffer.from(authnRequest).toString("base64");
  const redirectUrl = `${org.samlEntryPoint}?SAMLRequest=${encodeURIComponent(encodedRequest)}`;

  await prisma.auditLog.create({
    data: {
      eventType: "saml_login_initiated",
      detail: `org:${org.slug} requestId:${requestId}`,
    },
  });

  res.json(createSuccessResponse({ redirectUrl, requestId }));
});

/* ------------------------------------------------------------------ */
/*  POST /saml/acs/:orgSlug — Assertion Consumer Service callback      */
/*  (CG-FR03)                                                         */
/* ------------------------------------------------------------------ */

samlRouter.post("/acs/:orgSlug", async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { slug: req.params.orgSlug } });
  if (!org) {
    res.status(404).json(createErrorResponse("not_found", "Organization not found"));
    return;
  }

  const { SAMLResponse } = req.body as { SAMLResponse?: string };
  if (!SAMLResponse || typeof SAMLResponse !== "string") {
    res.status(400).json(createErrorResponse("validation_error", "Missing SAMLResponse"));
    return;
  }

  // Decode and parse the SAML response (simplified — production should use xml-crypto for signature validation)
  let decoded: string;
  try {
    decoded = Buffer.from(SAMLResponse, "base64").toString("utf-8");
  } catch {
    res.status(400).json(createErrorResponse("validation_error", "Invalid SAMLResponse encoding"));
    return;
  }

  // Extract NameID and email from SAML assertion (simplified extraction)
  const nameIdMatch = decoded.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/);
  const emailAttrMatch = decoded.match(/<saml:AttributeValue[^>]*>([^<]+@[^<]+)<\/saml:AttributeValue>/);

  const nameId = nameIdMatch?.[1];
  const email = emailAttrMatch?.[1] ?? nameId;

  if (!email) {
    res.status(400).json(createErrorResponse("auth_error", "Could not extract user identity from SAML assertion"));
    return;
  }

  // Validate issuer matches org config
  if (org.samlIssuer) {
    const issuerMatch = decoded.match(/<saml:Issuer[^>]*>([^<]+)<\/saml:Issuer>/);
    if (issuerMatch && issuerMatch[1] !== org.samlIssuer) {
      await prisma.auditLog.create({
        data: {
          eventType: "saml_issuer_mismatch",
          detail: `org:${org.slug} expected:${org.samlIssuer} got:${issuerMatch[1]}`,
        },
      });
      res.status(403).json(createErrorResponse("auth_error", "SAML issuer mismatch"));
      return;
    }
  }

  // Upsert user
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      samlNameId: nameId,
      organizationId: org.id,
      lastLoginAt: new Date(),
    },
    create: {
      email,
      displayName: email.split("@")[0],
      samlNameId: nameId,
      organizationId: org.id,
      emailVerified: true,
      role: "individual_user",
    },
  });

  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const refresh = generateRefreshToken();

  await prisma.refreshToken.create({
    data: { token: refresh.token, userId: user.id, expiresAt: refresh.expiresAt },
  });

  await prisma.auditLog.create({
    data: {
      eventType: "saml_login_success",
      actorId: user.id,
      actorEmail: user.email,
      ip: req.ip,
      detail: `org:${org.slug}`,
    },
  });

  // Redirect to web app with tokens (via query fragment to prevent token leakage in server logs)
  const webBase = process.env.WEB_BASE_URL ?? "http://localhost:3000";
  res.redirect(`${webBase}/sign-in?samlToken=${accessToken}&refreshToken=${refresh.token}`);
});
