// Shown to the client and stored word for word with their signature, so a
// change here must bump the version. Draft wording: have the agency confirm it.
export const SIGNATURE_CONSENT_VERSION = "2026-10-26";

export const SIGNATURE_CONSENT_PARAGRAPHS = [
  "I authorize my insurance agency, BRQR Insurance Agency, to keep my electronic signature on file and to apply it on my behalf to documents related to my insurance policies and claims, including loss run requests, carrier authorization forms and claim correspondence, without asking me to sign each document separately.",
  "I agree that my electronic signature has the same legal effect as my handwritten signature.",
  "I can revoke this authorization at any time by contacting my agent in writing. Revoking it does not affect documents signed before my agent receives the revocation.",
];

export const SIGNATURE_CONSENT_TEXT = SIGNATURE_CONSENT_PARAGRAPHS.join("\n\n");
