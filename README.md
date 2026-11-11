# Turniade 2026 · Fotobox

Die Galerie läuft als statische Website auf GitHub Pages. Fotos ansehen, nach Wochentag und Kategorien filtern und als einzelne Bilddateien herunterladen geht ohne Anmeldung. Bei einer Mehrfachauswahl startet die Galerie die Downloads nacheinander. Danach wird die heruntergeladene Auswahl zurückgesetzt. Unterstützt das Gerät das Teilen von Bilddateien, bietet das Teilen-Symbol einen Weg ins native Teilen-Menü.

Die vier Einträge in `config.js` sind Testfotos. Ihre Wochentage und Kategorien sind Beispieldaten.

## Fotoordner

- `Assets/Fotos/Originale/` enthält die Fotos zum Herunterladen.
- `Assets/Fotos/Vorschau/` enthält die kleineren Bilder für die Galerie.
- `Assets/Fotos/Import/` enthält die lokalen Ausgangsdateien. Git ignoriert diesen Ordner.
- `Assets/Design/` enthält das Logo und die Olympia-Grafiken.

## Lokal öffnen

Im Projektordner `python3 -m http.server 8765` ausführen und im Browser [http://localhost:8765](http://localhost:8765) öffnen.

## GitHub Pages einrichten

1. Die Projektdateien in das GitHub-Repository hochladen.
2. Im Repository unter **Settings → Pages → Build and deployment** die Quelle **Deploy from a branch** und **main / (root)** auswählen.
3. Die Galerie unter der in GitHub angezeigten Adresse öffnen. Für das vorhandene Repository ist die vorgesehene Adresse `https://nordqueens.github.io/Turniade26Fotobox/`.

Wer die Testfotos nur lokal nutzen möchte, ersetzt `samplePhotos` in `upload/sample-photos.mjs` durch ein leeres Array und lässt `Assets/Fotos/Originale` und `Assets/Fotos/Vorschau` beim Veröffentlichen weg. Die Galerie und die Fotodateien sind über ihre URLs öffentlich erreichbar.

## Passwortgeschützten Upload verbinden

Beim Freischalten vergleicht der Upload-Dienst einen PBKDF2-SHA-256-Hash mit zufälligem Salt. Die Anmeldung ist auf acht Versuche pro Minute und IP pro Cloudflare-Standort begrenzt. Anschließend gelten signierte Upload-Tokens für 30 Minuten. Der Dienst speichert Original, Vorschau, den ausgewählten Wochentag und die Kategorien. Nach erfolgreichem Upload erscheint das Foto in der Galerie. Für neue Fotos ist kein GitHub-Commit nötig. Pro Foto sind JPG, PNG oder WebP bis 20 MB und bis zu acht Kategorien möglich. Beim Hochladen ist der aktuelle Wochentag in der Zeitzone Europe/Berlin vorausgewählt. Außerhalb von Freitag bis Sonntag ist Freitag der Ausgangswert. Wochentag und Kategorien gelten für alle Fotos des Stapels. Neue Kategorien stehen nach Veröffentlichung des ersten Fotos auch in der Galerie und bei späteren Uploads zur Auswahl.

1. In Cloudflare R2 aktivieren und im Ordner `upload` diese Befehle ausführen.

   ```sh
   npx wrangler@4 login
   npx wrangler@4 r2 bucket create turniade-2026-fotos
   npx wrangler@4 deploy
   node create-upload-secret.mjs | npx wrangler@4 secret put UPLOAD_AUTH
   ```

   Bei der letzten Abfrage das vereinbarte Upload-Passwort eingeben. Die Eingabe bleibt verborgen. Nur Salt, Passwort-Hash und ein zufälliger Signaturschlüssel gehen als Cloudflare-Secret an den Worker. Den R2-Bucket privat lassen. Öffentliche Lesezugriffe laufen über den Worker. R2 hat ein monatliches Freikontingent und benötigt bei der Aktivierung eine Cloudflare-R2-Subscription.
2. Die vom Worker ausgegebene HTTPS-Adresse in `config.js` bei `apiBase` eintragen und die Änderung auf GitHub veröffentlichen.
3. Bei einer eigenen Domain den Origin in `upload/wrangler.toml` bei `SITE_ORIGINS` ergänzen und den Worker erneut bereitstellen. Ein Origin besteht aus Protokoll und Domain. Mehrere Origins werden durch Kommas getrennt. Für die lokale Entwicklung lässt sich der erlaubte Origin bei `wrangler dev` separat setzen.
4. Die veröffentlichte Galerie öffnen und über **Admin** das Passwort prüfen. Beim ersten Foto einen Wochentag wählen, veröffentlichen und die Galerie in einem zweiten Browserfenster öffnen.

[GitHub-Pages-Veröffentlichung](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [Cloudflare R2 mit Workers](https://developers.cloudflare.com/r2/get-started/workers-api/)

### Fotos melden und verwalten

Über das Ausrufezeichen in der Fotoansicht können Besucher ein Foto melden und einen Grund aus der Auswahlliste angeben. Der Fotodienst blendet es dann für alle Besucher aus. Offene Seiten aktualisieren die Galerie beim Wiederöffnen des Tabs oder spätestens mit dem nächsten Abruf nach bis zu 30 Sekunden. Die Dateien im privaten R2-Speicher bleiben zur Prüfung erhalten. Der Dienst begrenzt neue Meldungen pro IP und Cloudflare-Standort.

Die eigene Admin-Seite erreichst du über das Schloss oder direkt über `admin.html`. Die Sitzung bleibt im selben Browser-Tab bis zum Ablauf des 30-Minuten-Tokens oder bis zum Abmelden erhalten. Der Meldungszähler lädt beim Öffnen der Seite und aktualisiert sich bei Meldungen im selben Browser sofort sowie geräteübergreifend ungefähr alle zwölf Sekunden.

Unter **Admin → Gemeldet** lassen sich Meldungen prüfen. Über **Foto wieder anzeigen** wird das Foto erneut öffentlich sichtbar. Unter **Alle Fotos** lassen sich Wochentag und Kategorien ändern, Fotos ersetzen oder löschen. Beim Löschen einer über den Fotodienst hochgeladenen Datei werden Original und Vorschau aus R2 gelöscht. Ausgewählte Fotos lassen sich gemeinsam löschen oder um eine Kategorie ergänzen bzw. davon befreien. Eine geänderte Datei übernimmt den Meldestatus ihres Vorgängers.

Fest im öffentlichen Repository liegende Testbilder können in der Galerie ausgeblendet werden. Ihre statischen URLs bleiben erreichbar, bis die Dateien aus dem veröffentlichten Stand entfernt werden. Für Eventfotos den Upload verwenden, damit der Fotodienst auch den direkten Dateizugriff sperren kann.

### Upload lokal testen

Im Projektordner in einem separaten Terminal eine lokale Kopie des Workers starten. So bleiben die geheimen Daten außerhalb des Ordners, den der lokale Webserver ausliefert.

```sh
fotobox_worker_dir=$(mktemp -d)
cp upload/{auth.mjs,create-upload-secret.mjs,photos.mjs,report-reasons.mjs,sample-photos.mjs,worker.mjs,wrangler.toml} "$fotobox_worker_dir/"
cd "$fotobox_worker_dir"
node create-upload-secret.mjs --local
npx wrangler@4 dev --ip 127.0.0.1 --port 8787 --var SITE_ORIGINS:http://127.0.0.1:8765
```

Die Website unter [http://127.0.0.1:8765/?upload=local](http://127.0.0.1:8765/?upload=local) öffnen. Der Test nutzt lokalen Fotospeicher und benötigt kein Cloudflare-Konto.

## Schrift und Gestaltung

Die Überschriften nutzen die lokal installierte **Yovalina Dream**. Auf anderen Geräten greift **Bricolage Grotesque** als Ersatz. Der Fließtext nutzt **DM Sans**. Sobald eine für diese Website lizenzierte Webfont-Datei vorliegt, kann sie unter `Assets/Design` abgelegt und im ersten `@font-face` in `styles.css` als zusätzliche `url("Assets/Design/YovalinaDream-Regular.woff2") format("woff2")` ergänzt werden. Alle Komponenten sind mit eigenem CSS gestaltet.
