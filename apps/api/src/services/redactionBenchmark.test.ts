import { describe, it, expect } from "vitest";
import { redactPII } from "../services/redactionService.js";

/**
 * PII Redaction Benchmark (CG-NFR29)
 * Validates precision >= 0.98 and recall >= 0.95 across comprehensive datasets.
 */

/* ------------------------------------------------------------------ */
/*  True-positive corpus — every item contains exactly one PII entity  */
/* ------------------------------------------------------------------ */

const TRUE_POSITIVE_CASES: { type: string; text: string; pii: string }[] = [
  // SSN variants
  { type: "ssn", text: "My SSN is 123-45-6789.", pii: "123-45-6789" },
  { type: "ssn", text: "Social: 999-88-7777 on file.", pii: "999-88-7777" },
  { type: "ssn", text: "SSN 000-12-3456 was leaked.", pii: "000-12-3456" },
  { type: "ssn", text: "Her number is 321-54-9876.", pii: "321-54-9876" },
  { type: "ssn", text: "Record shows 456-78-9012.", pii: "456-78-9012" },
  { type: "ssn", text: "SSN: 111-11-1111 in database.", pii: "111-11-1111" },
  { type: "ssn", text: "Reference number 222-33-4444.", pii: "222-33-4444" },
  { type: "ssn", text: "Verified 555-66-7788 identity.", pii: "555-66-7788" },
  { type: "ssn", text: "Please use 987-65-4321.", pii: "987-65-4321" },
  { type: "ssn", text: "File for 100-20-3000.", pii: "100-20-3000" },

  // Phone number variants
  { type: "phone", text: "Call (555) 123-4567 now.", pii: "(555) 123-4567" },
  { type: "phone", text: "Phone: 555-123-4567.", pii: "555-123-4567" },
  { type: "phone", text: "Dial 555.123.4567 today.", pii: "555.123.4567" },
  { type: "phone", text: "Reach me at +1 555 123 4567.", pii: "+1 555 123 4567" },
  { type: "phone", text: "Contact 800-555-0199.", pii: "800-555-0199" },
  { type: "phone", text: "Mobile (212) 555-0100.", pii: "(212) 555-0100" },
  { type: "phone", text: "Text 310-555-0150.", pii: "310-555-0150" },
  { type: "phone", text: "Fax: 646.555.0123.", pii: "646.555.0123" },
  { type: "phone", text: "Work phone 415-555-0198.", pii: "415-555-0198" },
  { type: "phone", text: "Home: 702-555-0147.", pii: "702-555-0147" },

  // Email variants
  { type: "email", text: "Email john@example.com.", pii: "john@example.com" },
  { type: "email", text: "Send to jane.doe@company.co.uk.", pii: "jane.doe@company.co.uk" },
  { type: "email", text: "user+tag@gmail.com is subscribed.", pii: "user+tag@gmail.com" },
  { type: "email", text: "admin@sub.domain.org is root.", pii: "admin@sub.domain.org" },
  { type: "email", text: "Contact info@my-site.com.", pii: "info@my-site.com" },
  { type: "email", text: "Notify alice.bob@test.io.", pii: "alice.bob@test.io" },
  { type: "email", text: "Reply to support@company.net.", pii: "support@company.net" },
  { type: "email", text: "Use first.last@university.edu.", pii: "first.last@university.edu" },
  { type: "email", text: "Forward to sales@startup.co.", pii: "sales@startup.co" },
  { type: "email", text: "CC team_lead@corp.biz.", pii: "team_lead@corp.biz" },

  // Credit card variants
  { type: "credit_card", text: "Card: 4111 1111 1111 1111.", pii: "4111 1111 1111 1111" },
  { type: "credit_card", text: "Visa 4111-1111-1111-1111.", pii: "4111-1111-1111-1111" },
  { type: "credit_card", text: "MC 5500 0000 0000 0004.", pii: "5500 0000 0000 0004" },
  { type: "credit_card", text: "Amex 3782 8224 6310 0050.", pii: "3782 8224 6310 0050" },
  { type: "credit_card", text: "Card ending 4222222222222.", pii: "4222222222222" },
  { type: "credit_card", text: "Pay with 6011-0009-9013-9424.", pii: "6011-0009-9013-9424" },
  { type: "credit_card", text: "Number 4012888888881881.", pii: "4012888888881881" },
  { type: "credit_card", text: "Charged to 5105 1051 0510 5100.", pii: "5105 1051 0510 5100" },

  // IP address variants
  { type: "ip_address", text: "Server at 192.168.1.1.", pii: "192.168.1.1" },
  { type: "ip_address", text: "From IP 10.0.0.255.", pii: "10.0.0.255" },
  { type: "ip_address", text: "Gateway 172.16.0.1.", pii: "172.16.0.1" },
  { type: "ip_address", text: "Logged from 8.8.8.8.", pii: "8.8.8.8" },
  { type: "ip_address", text: "DNS server 1.1.1.1.", pii: "1.1.1.1" },
  { type: "ip_address", text: "Request from 203.0.113.50.", pii: "203.0.113.50" },
  { type: "ip_address", text: "Blocked 198.51.100.14.", pii: "198.51.100.14" },
  { type: "ip_address", text: "Origin IP 100.64.0.1.", pii: "100.64.0.1" },

  // Date of birth variants
  { type: "date_of_birth", text: "Born on 01/15/1990.", pii: "01/15/1990" },
  { type: "date_of_birth", text: "DOB: 12/31/2000.", pii: "12/31/2000" },
  { type: "date_of_birth", text: "Birthday 06/01/1985.", pii: "06/01/1985" },
  { type: "date_of_birth", text: "Date of birth 03/22/1975.", pii: "03/22/1975" },
  { type: "date_of_birth", text: "Born 11/11/1999.", pii: "11/11/1999" },
  { type: "date_of_birth", text: "DOB is 07/04/2001.", pii: "07/04/2001" },
  { type: "date_of_birth", text: "Patient DOB 09/30/1960.", pii: "09/30/1960" },
  { type: "date_of_birth", text: "Registered 02/28/1988.", pii: "02/28/1988" },
];

/* ------------------------------------------------------------------ */
/*  True-negative corpus — no PII present in any item                  */
/* ------------------------------------------------------------------ */

const TRUE_NEGATIVE_CASES: string[] = [
  "The economy grew by 3.5% last year.",
  "We should focus on educational reform.",
  "Climate change affects everyone.",
  "The committee meets every Tuesday at noon.",
  "Section 501(c)(3) organizations are tax-exempt.",
  "Our proposal has three main pillars.",
  "References: Smith et al., 2023.",
  "The minimum wage should be adjusted for inflation.",
  "Healthcare spending accounts for 18% of GDP.",
  "The 2024 election cycle begins in earnest.",
  "Paragraph 4.2.1 of the agreement states...",
  "Revenue increased from $2M to $3.5M year-over-year.",
  "The board voted 7-2 in favor of the proposal.",
  "Average class sizes range from 15-25 students.",
  "The project timeline spans 12-18 months.",
  "Version 2.0 includes several improvements.",
  "Building codes require 10-foot ceilings.",
  "The study enrolled 150 participants across 3 sites.",
  "Annual reports are filed by March 31st each year.",
  "Chapters 1-5 cover the fundamentals.",
  "Production output: 500 units per day on a 3-shift rotation.",
  "Congressional district lines were redrawn.",
  "RSVP by the end of next week.",
  "The standard deviation was 0.42.",
  "Temperature was maintained at 72 degrees Fahrenheit.",
  "We need a two-thirds majority to proceed.",
  "Floor 12, Suite 300 is the main office.",
  "Order number: A100-B200-C300",
  "Serial code XK-4429-ZM verified.",
  "The ratio of teachers to students is 1:20.",
];

/* ------------------------------------------------------------------ */
/*  Multi-PII corpus — texts with multiple PII items                   */
/* ------------------------------------------------------------------ */

const MULTI_PII_CASES: { text: string; expectedCount: number }[] = [
  { text: "Name: John, SSN: 111-22-3333, phone: 555-444-3333, email: john@test.com", expectedCount: 3 },
  { text: "Card 4111 1111 1111 1111 from IP 10.0.0.1 on 01/15/1990", expectedCount: 3 },
  { text: "Contact user@example.com or call 800-555-0199 about SSN 999-88-7777", expectedCount: 3 },
  { text: "DOB 06/01/1985, phone (212) 555-0100, email admin@corp.biz", expectedCount: 3 },
  { text: "IPs 192.168.1.1 and 10.0.0.255 logged for user@site.org", expectedCount: 3 },
];

/* ------------------------------------------------------------------ */
/*  Benchmark metrics                                                  */
/* ------------------------------------------------------------------ */

describe("PII Redaction Benchmark (CG-NFR29)", () => {
  it("achieves recall >= 0.95 across true-positive corpus", () => {
    let detected = 0;
    let total = TRUE_POSITIVE_CASES.length;

    for (const tc of TRUE_POSITIVE_CASES) {
      const result = redactPII(tc.text);
      if (result.findings > 0 && !result.redactedText.includes(tc.pii)) {
        detected++;
      }
    }

    const recall = detected / total;
    expect(recall).toBeGreaterThanOrEqual(0.95);
  });

  it("achieves precision >= 0.98 across true-negative corpus", () => {
    let falsePositives = 0;
    let total = TRUE_NEGATIVE_CASES.length;

    for (const text of TRUE_NEGATIVE_CASES) {
      const result = redactPII(text);
      if (result.findings > 0) {
        falsePositives++;
      }
    }

    // Precision = 1 - (false_positives / total_negatives)
    const precision = 1 - falsePositives / total;
    expect(precision).toBeGreaterThanOrEqual(0.98);
  });

  it("correctly masks all PII types individually", () => {
    const typeGroups = new Map<string, typeof TRUE_POSITIVE_CASES>();
    for (const tc of TRUE_POSITIVE_CASES) {
      const group = typeGroups.get(tc.type) ?? [];
      group.push(tc);
      typeGroups.set(tc.type, group);
    }

    for (const [type, cases] of typeGroups) {
      let typeDetected = 0;
      for (const tc of cases) {
        const result = redactPII(tc.text);
        if (result.findings > 0 && !result.redactedText.includes(tc.pii)) {
          typeDetected++;
        }
      }
      const typeRecall = typeDetected / cases.length;
      expect(typeRecall, `Recall for ${type} = ${typeRecall}`).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("correctly handles multi-PII texts", () => {
    for (const tc of MULTI_PII_CASES) {
      const result = redactPII(tc.text);
      expect(result.findings).toBeGreaterThanOrEqual(tc.expectedCount);
    }
  });

  it("does not block clean debate text", () => {
    for (const text of TRUE_NEGATIVE_CASES) {
      const result = redactPII(text);
      expect(result.blocked).toBe(false);
    }
  });

  it("maintains pipeline confidence >= 0.85 on all inputs", () => {
    const allTexts = [
      ...TRUE_POSITIVE_CASES.map((tc) => tc.text),
      ...TRUE_NEGATIVE_CASES,
    ];

    for (const text of allTexts) {
      const result = redactPII(text);
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    }
  });

  it("validate stage reports 0 residual after masking for all true-positives", () => {
    for (const tc of TRUE_POSITIVE_CASES) {
      const result = redactPII(tc.text);
      const validateStage = result.stages.find((s) => s.stage === "validate");
      expect(validateStage?.findingsCount, `Residual PII in: ${tc.text}`).toBe(0);
    }
  });

  it("masking produces correct placeholder format", () => {
    for (const tc of TRUE_POSITIVE_CASES) {
      const result = redactPII(tc.text);
      if (result.findings > 0) {
        const placeholder = `[REDACTED:${tc.type.toUpperCase()}]`;
        expect(result.redactedText, `Missing placeholder for ${tc.type}`).toContain(placeholder);
      }
    }
  });

  it("aggregate metrics summary", () => {
    // True positives
    let tpDetected = 0;
    for (const tc of TRUE_POSITIVE_CASES) {
      const result = redactPII(tc.text);
      if (result.findings > 0 && !result.redactedText.includes(tc.pii)) {
        tpDetected++;
      }
    }
    const recall = tpDetected / TRUE_POSITIVE_CASES.length;

    // True negatives
    let fpCount = 0;
    for (const text of TRUE_NEGATIVE_CASES) {
      const result = redactPII(text);
      if (result.findings > 0) fpCount++;
    }
    const fpRate = fpCount / TRUE_NEGATIVE_CASES.length;

    // Overall precision: TP / (TP + FP)
    const totalTP = tpDetected;
    const precision = totalTP / (totalTP + fpCount);

    expect(recall, `Recall: ${recall}`).toBeGreaterThanOrEqual(0.95);
    expect(precision, `Precision: ${precision}`).toBeGreaterThanOrEqual(0.98);
    expect(fpRate, `False positive rate: ${fpRate}`).toBeLessThanOrEqual(0.02);
  });
});
