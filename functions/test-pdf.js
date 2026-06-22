// Local PDF render check — writes test-out.pdf so the layout/fonts/logo can be inspected.
// Run: node functions/test-pdf.js
import { buildProformaPdf } from "./index.js";
import { writeFileSync } from "fs";

const pdf = await buildProformaPdf({
  proformaNumber: "PF/2026/0001",
  order: {
    name: "Firma Łąka Ćma Spółka z o.o.",
    address: "ul. Żółwia 12/3\n00-001 Łódź\nPolska",
    vatNumber: "PL1234567890",
    email: "klient@example.com",
    phone: "+48 600 100 200",
  },
  totals: { qty: 3, net: 243.9, vat: 56.1, gross: 300 },
  dates: { issue: "2026-06-22", due: "2026-06-29" },
});
writeFileSync(new URL("./test-out.pdf", import.meta.url), pdf);
console.log("wrote test-out.pdf", pdf.length, "bytes");
