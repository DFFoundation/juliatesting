// src/nosCodes.js
export const NOS_GROUPS = [
  {
    label: "Administrative / Government Action",
    codes: [
      { code: "899", label: "APA / Administrative Review", description: "Cases challenging federal agency action under the APA", defaultOn: true },
      { code: "895", label: "FOIA / Transparency", description: "Freedom of Information Act cases", defaultOn: true },
      { code: "890", label: "Other Statutory Actions", description: "Other federal statutory claims", defaultOn: true },
    ],
  },
  {
    label: "Civil Rights & Voting",
    codes: [
      { code: "441", label: "Voting Rights", description: "Voting rights and election integrity cases", defaultOn: true },
      { code: "440", label: "Other Civil Rights", description: "General civil rights claims", defaultOn: true },
      { code: "442", label: "Civil Rights — Employment", description: "Employment discrimination under civil rights statutes", defaultOn: true },
      { code: "443", label: "Civil Rights — Housing", description: "Housing discrimination", defaultOn: false },
      { code: "444", label: "Civil Rights — Welfare", description: "Public benefits civil rights claims", defaultOn: false },
      { code: "445", label: "ADA — Employment", description: "Americans with Disabilities Act employment claims", defaultOn: false },
      { code: "446", label: "ADA — Other", description: "Other ADA claims", defaultOn: false },
      { code: "448", label: "Education Policy", description: "Federal education law and policy cases", defaultOn: true },
    ],
  },
  {
    label: "Immigration",
    codes: [
      { code: "463", label: "Habeas — Alien Detainee", description: "Habeas corpus for detained immigrants", defaultOn: true },
      { code: "465", label: "Other Immigration", description: "Immigration enforcement, DACA, removal challenges", defaultOn: true },
      { code: "462", label: "Immigration — Naturalization", description: "Naturalization and citizenship cases", defaultOn: false },
    ],
  },
  {
    label: "Federal Employment & Labor",
    codes: [
      { code: "790", label: "Other Labor Litigation", description: "Federal employee and labor cases", defaultOn: true },
      { code: "791", label: "ERISA / Federal Benefits", description: "Federal employee benefits and pension disputes", defaultOn: true },
      { code: "710", label: "Fair Labor Standards Act", description: "FLSA claims against federal employers", defaultOn: false },
    ],
  },
  {
    label: "Constitutional / Other Federal",
    codes: [
      { code: "870", label: "Federal Tax (U.S. Defendant)", description: "Tax cases where U.S. is defendant", defaultOn: true },
      { code: "893", label: "Environmental / Regulatory", description: "Environmental law and regulatory enforcement", defaultOn: true },
    ],
  },
];

export const DEFAULT_NOS = new Set(
  NOS_GROUPS.flatMap((g) => g.codes.filter((c) => c.defaultOn).map((c) => c.code))
);

export const NOS_LABEL_MAP = Object.fromEntries(
  NOS_GROUPS.flatMap((g) => g.codes.map((c) => [c.code, c.label]))
);

export const NOS_DESC_MAP = Object.fromEntries(
  NOS_GROUPS.flatMap((g) => g.codes.map((c) => [c.code, c.description]))
);
