# Turniade 2026 · Fotobox

Die statische Galerie auf GitHub Pages sortiert Fotos nach Freitag, Samstag und Sonntag. Besucher können die Fotos ansehen, einzeln herunterladen oder mehrere zum Download auswählen.

## Fotos über Finder oder GitHub hinzufügen

Lege JPG-, PNG- oder WebP-Dateien in den passenden Ordner:

- `Assets/Fotos/Freitag/`
- `Assets/Fotos/Samstag/`
- `Assets/Fotos/Sonntag/`

Danach die Dateien committen und auf `main` pushen. GitHub Pages erstellt die Fotoliste beim nächsten Build automatisch. In **Settings → Pages** bleibt **Deploy from a branch → main / (root)** eingestellt. Das Beispielbild vom Sonntag liegt bereits im Sonntagsordner. Der Ordner `Assets/Fotos/Import/` ist für lokale Ausgangsdateien und wird beim Veröffentlichen ausgelassen.

## Fotos über den Admin-Bereich hinzufügen

1. Erstelle auf GitHub einen [Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new). Wähle nur `Turniade26Fotobox` und unter **Repository permissions** die Berechtigung **Contents → Read and write**.
2. Öffne **Admin** auf der Fotobox und gib das bisherige Passwort und den GitHub-Schlüssel ein. Die Admin-Seite prüft den Passwort-Hash im Browser. GitHub prüft die Schreibberechtigung.
3. Wähle mehrere Bilder auf einmal, stelle den gemeinsamen Wochentag ein und drücke **Fotos veröffentlichen**. Ein Stapel wird in einem Commit gespeichert. Originale und Vorschauen aus dem Admin-Upload liegen in `Assets/Fotos/Originale/` und `Assets/Fotos/Vorschau/`.

Über **Alle Fotos** kannst du Fotos beider Wege bearbeiten, ersetzen oder löschen. Der GitHub-Schlüssel bleibt bis zum Abmelden oder bis zu 30 Minuten im selben Browser-Tab gespeichert. Fotos aus dem öffentlichen Repository können nach dem Löschen im Git-Verlauf abrufbar bleiben.

Für eine einfache lokale Vorschau `python3 -m http.server 8765` im Projektordner starten. Die Wochentagsordner werden beim Jekyll-Build von GitHub Pages eingelesen.

[GitHub Pages mit Jekyll](https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/about-github-pages-and-jekyll)

## Schrift und Gestaltung

Die Überschriften nutzen die lokal installierte **Yovalina Dream**. Auf anderen Geräten greift **Bricolage Grotesque** als Ersatz. Der Fließtext nutzt **DM Sans**. Sobald eine für diese Website lizenzierte Webfont-Datei vorliegt, kann sie unter `Assets/Design` abgelegt und im ersten `@font-face` in `styles.css` als zusätzliche `url("Assets/Design/YovalinaDream-Regular.woff2") format("woff2")` ergänzt werden. Alle Komponenten sind mit eigenem CSS gestaltet.
