// Nach der Einrichtung die HTTPS-Adresse des Upload-Dienstes eintragen.
export const apiBase = "";

export const defaultTags = ["Auftritt", "Bodenturnen", "Team"];

export const samplePhotos = [
  { id: "probe-1", name: "IMG_2258.PNG", day: "Freitag", tags: ["Auftritt", "Team"], alt: "Turngruppe bei einer gemeinsamen Pose auf der Matte" },
  { id: "probe-2", name: "IMG_0288.PNG", day: "Samstag", tags: ["Auftritt", "Bodenturnen"], alt: "Turnerinnen zeigen akrobatische Figuren in der Halle" },
  { id: "probe-3", name: "IMG_5962.jpeg", day: "Samstag", tags: ["Team"], alt: "Die Turngruppe posiert gemeinsam für ein Teamfoto" },
  { id: "probe-4", name: "IMG_7156.jpeg", day: "Sonntag", tags: ["Team"], alt: "Gruppenfoto vor dem Brandenburger Tor" }
].map(photo => ({
  ...photo,
  source: "Assets/Fotos/Originale/" + photo.name,
  thumbnail: photo.id === "probe-4"
    ? "Assets/Fotos/Originale/" + photo.name
    : "Assets/Fotos/Vorschau/" + photo.name.replace(/\.[^.]+$/, ".jpg")
}));
