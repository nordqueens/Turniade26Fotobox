export const samplePhotos = [
  { id: "probe-1", name: "IMG_2258.PNG", day: "Freitag", alt: "Turngruppe bei einer gemeinsamen Pose auf der Matte" },
  { id: "probe-2", name: "IMG_0288.PNG", day: "Samstag", alt: "Turnerinnen zeigen akrobatische Figuren in der Halle" },
  { id: "probe-3", name: "IMG_5962.jpeg", day: "Samstag", alt: "Die Turngruppe posiert gemeinsam für ein Teamfoto" },
].map(photo => ({
  ...photo,
  source: "Assets/Fotos/Originale/" + photo.name,
  thumbnail: "Assets/Fotos/Vorschau/" + photo.name.replace(/\.[^.]+$/, ".jpg")
}));
