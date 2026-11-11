# Turniade 2026 · Fotobox

Die Galerie läuft als statische Website auf GitHub Pages. Fotos ansehen, nach Wochentag und Tags filtern und als einzelne Bilddateien herunterladen geht ohne Anmeldung. Bei einer Mehrfachauswahl startet die Galerie die Downloads nacheinander. Danach wird die heruntergeladene Auswahl zurückgesetzt. Unterstützt das Gerät das Teilen von Bilddateien, bietet das Teilen-Symbol einen Weg ins native Teilen-Menü.

Die vier Einträge in `config.js` sind Testfotos. Ihre Tage und Tags sind Beispieldaten.

## Fotoordner

- `Assets/Fotos/Originale/` enthält die Fotos zum Herunterladen.
- `Assets/Fotos/Vorschau/` enthält die kleineren Bilder für Galerie und Slideshow.
- `Assets/Fotos/Import/` enthält die lokalen Ausgangsdateien. Git ignoriert diesen Ordner.
- `Assets/Design/` enthält das Logo und die Olympia-Grafiken.

## Lokal öffnen

Im Projektordner `python3 -m http.server 8765` ausführen und im Browser [http://localhost:8765](http://localhost:8765) öffnen.

## GitHub Pages einrichten

1. Die Projektdateien in das GitHub-Repository hochladen.
2. Im Repository unter **Settings → Pages → Build and deployment** die Quelle **Deploy from a branch** und **main / (root)** auswählen.
3. Die Galerie unter der in GitHub angezeigten Adresse öffnen. Für das vorhandene Repository ist die vorgesehene Adresse `https://nordqueens.github.io/Turniade26Fotobox/`.

Wer die Testfotos nur lokal nutzen möchte, ersetzt `samplePhotos` in `config.js` durch ein leeres Array und lässt `Assets/Fotos/Originale` und `Assets/Fotos/Vorschau` beim Veröffentlichen weg. Die Galerie und die Fotodateien sind über ihre URLs öffentlich erreichbar.

## Passwortgeschützten Upload verbinden

Der Upload-Dienst prüft das Passwort bei jedem Upload und speichert Original, Vorschau, den ausgewählten Wochentag und die Tags. Nach erfolgreichem Upload erscheint das Foto in der Galerie. Für neue Fotos ist kein GitHub-Commit nötig. Pro Foto sind JPG, PNG oder WebP bis 20 MB und bis zu acht Tags möglich. Bei einer Mehrfachauswahl gelten Tag und Tags für alle Fotos des Stapels. Neue Tags stehen nach Veröffentlichung des ersten Fotos auch in der Galerie und bei späteren Uploads zur Auswahl.

1. In Cloudflare R2 aktivieren und im Ordner `upload` diese Befehle ausführen.

   ```sh
   npx wrangler login
   npx wrangler r2 bucket create turniade-2026-fotos
   npx wrangler deploy
   npx wrangler secret put UPLOAD_PASSWORD
   ```

   Bei der letzten Abfrage das vereinbarte Upload-Passwort eingeben. Den R2-Bucket privat lassen. Öffentliche Lesezugriffe laufen über den Worker.
2. Die vom Worker ausgegebene HTTPS-Adresse in `config.js` bei `apiBase` eintragen und die Änderung auf GitHub veröffentlichen.
3. Bei einer eigenen Domain den Origin in `upload/wrangler.toml` bei `SITE_ORIGINS` ergänzen und den Worker erneut bereitstellen. Ein Origin besteht aus Protokoll und Domain. Mehrere Origins werden durch Kommas getrennt. Für einen lokalen Browsertest kann zum Beispiel `http://localhost:8765` ergänzt werden.
4. Die veröffentlichte Galerie öffnen und über **Fotos hochladen** das Passwort prüfen. Beim ersten Foto einen Tag wählen, veröffentlichen und die Galerie in einem zweiten Browserfenster öffnen.

[GitHub-Pages-Veröffentlichung](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [Cloudflare R2 mit Workers](https://developers.cloudflare.com/r2/get-started/workers-api/)

## Schrift und Gestaltung

Die Überschriften nutzen die lokal installierte **Yovalina Dream**. Auf anderen Geräten greift **Bricolage Grotesque** als Ersatz. Der Fließtext nutzt **DM Sans**. Sobald eine für diese Website lizenzierte Webfont-Datei vorliegt, kann sie unter `Assets/Design` abgelegt und im ersten `@font-face` in `styles.css` als zusätzliche `url("Assets/Design/YovalinaDream-Regular.woff2") format("woff2")` ergänzt werden. Alle Komponenten sind mit eigenem CSS gestaltet.
