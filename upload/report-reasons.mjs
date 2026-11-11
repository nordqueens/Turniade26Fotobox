export const reportReasons = {
  remove_self: "Ich bin auf dem Foto und möchte, dass es gelöscht wird.",
  weekday: "Der Wochentag ist falsch.",
  category: "Die Kategorie ist falsch.",
  inappropriate: "Auf dem Foto ist etwas Unangemessenes zu sehen.",
  privacy_violation: "Das Foto verletzt die Privatsphäre.",
  personal_info: "Mein Name oder andere persönliche Daten sind zu sehen.",
  bullying: "Das Foto macht sich über jemanden lustig.",
  unrelated: "Das Foto gehört nicht zur Turniade.",
  other: "Sonstiges"
};

export function reportReasonLabel(reason) {
  if (reason === "privacy") return "Ich bin auf dem Foto und möchte, dass es ausgeblendet wird.";
  return Object.hasOwn(reportReasons, reason) ? reportReasons[reason] : "Kein Meldegrund angegeben.";
}
